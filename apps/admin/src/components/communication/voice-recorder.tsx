'use client';

/*
 * The recorder lives in @nilzora/ui so the customer's widget and the Admin Communication Center
 * record a voice note with one implementation. This module keeps the Communication Center's
 * existing import path (and its tests) working.
 */
export { VoiceRecorder, type RecordedVoice, type VoiceRecorderState } from '@nilzora/ui';
