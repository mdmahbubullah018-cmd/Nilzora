package expo.modules.nilzoraspeech

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import androidx.core.content.ContextCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Speech to text for voice search, on top of Android's own SpeechRecognizer.
 *
 * What it does, and what it deliberately does not:
 *  - It listens only between `start` and the end of the result (or `stop` / `cancel`), and emits
 *    `onState`, `onPartial` (live words), `onResult` (the final text and the language the engine
 *    identified), `onLanguage` (that identification, as soon as it is known), `onLevel` (0..1, for
 *    the listening animation) and `onError` (a short code, never the platform's message).
 *  - From Android 14 the recognizer is asked to identify the spoken language itself, from the
 *    audio, among the languages this store speaks. Nothing reads the phone's language setting in
 *    that path, so a customer never has to change it. Older platforms, and a deliberate retry,
 *    pass one language through `EXTRA_LANGUAGE` instead.
 *  - It never records to a file and never keeps or sends audio itself: the platform's recognition
 *    service receives the audio and returns text. Nothing is stored here.
 *  - The microphone and the recognizer are released on every end, on `cancel`, when the app goes
 *    to the background, and when the module is destroyed.
 *  - The RECORD_AUDIO permission is requested by the JS side only when the customer taps the
 *    microphone; without it `start` answers with the `permission` error instead of listening.
 * SpeechRecognizer is a main-thread API, so every function runs on the main queue.
 */
class NilzoraSpeechModule : Module() {
  private var recognizer: SpeechRecognizer? = null
  private var lastLevelAt = 0L

  /**
   * What the engine may identify on its own: the two languages this store speaks. Bangla is
   * offered in both its Bangladesh and India models, because the platform's Bangla model is
   * usually the Indian one.
   */
  private val detectableLanguages = arrayListOf("en-US", "bn-BD", "bn-IN")

  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No Android context")

  override fun definition() = ModuleDefinition {
    Name("NilzoraSpeech")

    Events("onState", "onPartial", "onResult", "onLanguage", "onError", "onLevel")

    Function("isAvailable") {
      SpeechRecognizer.isRecognitionAvailable(context)
    }

    // `forceLanguage` switches automatic identification off for one attempt: the JS side passes
    // it when it deliberately listens again in a particular language after a failed try.
    AsyncFunction("start") { locale: String, forceLanguage: Boolean ->
      begin(locale, forceLanguage)
    }.runOnQueue(Queues.MAIN)

    // What the engine can identify on its own, so the JS side knows whether to rely on it.
    Function("canDetectLanguage") {
      Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE
    }

    // Stop listening and deliver what was heard so far as the final result.
    AsyncFunction("stop") {
      recognizer?.stopListening()
    }.runOnQueue(Queues.MAIN)

    // Abandon the attempt: nothing is delivered, everything is released.
    AsyncFunction("cancel") {
      release()
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      // Never keep the microphone while the app is out of sight.
      release()
    }

    OnDestroy {
      release()
    }
  }

  private fun begin(locale: String, forceLanguage: Boolean) {
    release()
    if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO)
      != PackageManager.PERMISSION_GRANTED
    ) {
      emitError("permission")
      return
    }
    if (!SpeechRecognizer.isRecognitionAvailable(context)) {
      emitError("unavailable")
      return
    }

    val created = SpeechRecognizer.createSpeechRecognizer(context)
    created.setRecognitionListener(listener)
    recognizer = created

    val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
      // A short spoken search, not dictation.
      putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_WEB_SEARCH)
      putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
      putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
      putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, context.packageName)
      if (detectionAvailable && !forceLanguage) {
        // Android 14 and later: the engine decides from the audio whether this was English or
        // Bangla. EXTRA_LANGUAGE is deliberately not set, because a request for one language
        // is what stops the engine identifying the other.
        putExtra(RecognizerIntent.EXTRA_ENABLE_LANGUAGE_DETECTION, true)
        putStringArrayListExtra(
          RecognizerIntent.EXTRA_LANGUAGE_DETECTION_ALLOWED_LANGUAGES,
          detectableLanguages,
        )
      } else {
        putExtra(RecognizerIntent.EXTRA_LANGUAGE, locale)
      }
    }
    created.startListening(intent)
    sendEvent("onState", mapOf("state" to "starting"))
  }

  /** Whether this platform can identify the spoken language from the audio. */
  private val detectionAvailable: Boolean
    get() = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE

  /** The language the engine identified for this attempt, when it says. */
  private fun detectedLanguage(bundle: Bundle?): String? {
    if (!detectionAvailable) return null
    val tag = bundle?.getString(SpeechRecognizer.DETECTED_LANGUAGE)?.trim()
    return if (tag.isNullOrEmpty()) null else tag
  }

  /** Releases the recognizer (and with it the microphone). Safe to call at any time. */
  private fun release() {
    val current = recognizer ?: return
    recognizer = null
    try {
      current.setRecognitionListener(null)
      current.cancel()
      current.destroy()
    } catch (_: Exception) {
      // Already released by the platform.
    }
  }

  private fun emitError(code: String) {
    sendEvent("onError", mapOf("code" to code))
  }

  private fun firstResult(bundle: Bundle?): String {
    val list = bundle?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
    return list?.firstOrNull()?.trim() ?: ""
  }

  private val listener = object : RecognitionListener {
    override fun onReadyForSpeech(params: Bundle?) {
      sendEvent("onState", mapOf("state" to "listening"))
    }

    override fun onBeginningOfSpeech() {
      sendEvent("onState", mapOf("state" to "hearing"))
    }

    override fun onRmsChanged(rmsdB: Float) {
      // About twelve updates a second is plenty for an animation; no more bridge traffic.
      val now = System.currentTimeMillis()
      if (now - lastLevelAt < 80) return
      lastLevelAt = now
      val level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f)
      sendEvent("onLevel", mapOf("level" to level))
    }

    override fun onBufferReceived(buffer: ByteArray?) {}

    override fun onEndOfSpeech() {
      sendEvent("onState", mapOf("state" to "processing"))
    }

    override fun onPartialResults(partialResults: Bundle?) {
      val text = firstResult(partialResults)
      if (text.isNotEmpty()) sendEvent("onPartial", mapOf("text" to text))
    }

    override fun onResults(results: Bundle?) {
      val text = firstResult(results)
      val language = detectedLanguage(results)
      release()
      if (text.isEmpty()) {
        emitError("no_speech")
        return
      }
      val payload = mutableMapOf<String, Any>("text" to text)
      if (language != null) payload["language"] = language
      sendEvent("onResult", payload)
    }

    /** Android 14+: the language the engine decided on, usually before the final text. */
    override fun onLanguageDetection(results: Bundle) {
      val language = detectedLanguage(results) ?: return
      sendEvent("onLanguage", mapOf("language" to language))
    }

    override fun onError(error: Int) {
      release()
      emitError(
        when (error) {
          SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no_speech"
          SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT,
          SpeechRecognizer.ERROR_SERVER -> "network"
          SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "permission"
          SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "busy"
          12, 13 -> "language" // ERROR_LANGUAGE_NOT_SUPPORTED, ERROR_LANGUAGE_UNAVAILABLE
          SpeechRecognizer.ERROR_AUDIO -> "audio"
          else -> "failed"
        },
      )
    }

    override fun onEvent(eventType: Int, params: Bundle?) {}
  }
}
