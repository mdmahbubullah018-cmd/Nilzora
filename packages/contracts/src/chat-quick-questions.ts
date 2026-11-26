/*
 * The questions customers ask most, one tap away
 * ----------------------------------------------
 * One list, shared by the website and the Android app, so the two can never drift apart and so a
 * single test can hold every option to the answer it must produce.
 *
 * A chip only *writes* the question into the message box; it never sends it. That matters for two
 * reasons: a tap cannot post a message the customer did not read first, and the wording is a
 * question, not a command. "Can I cancel my order?" is answered from the customer's own order:
 * while it is still pending they can cancel it themselves from the order page (cancel_my_order),
 * and for any other state a teammate reviews the request. A button called "Cancel order" here
 * would wrongly promise that this chat cancels anything.
 */
export interface ChatQuickQuestion {
  label: string;
  question: string;
}

export const CHAT_QUICK_QUESTIONS: readonly ChatQuickQuestion[] = [
  { label: 'Where is my order?', question: 'Where is my order, please?' },
  { label: 'Track my delivery', question: 'Can you tell me where my delivery has reached?' },
  { label: 'Product help', question: 'I need help choosing a product. Could you advise me?' },
  { label: 'Delivery charges', question: 'What are the delivery charges for my area?' },
  { label: 'Return or exchange', question: 'How do I return or exchange an item?' },
  { label: 'Payment', question: 'I have a question about paying for my order.' },
  { label: 'Cancel an order', question: 'Can I cancel my order?' },
];
