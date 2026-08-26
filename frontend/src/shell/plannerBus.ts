/** The Sidebar (persistent across routes) triggers "+ New chat" through this
 * tiny event bus rather than needing PlannerProvider's internals directly —
 * asking a query, by contrast, goes straight through usePlanner().plan()
 * now that both App.tsx and the Sidebar sit inside the provider. */
export const NEW_CHAT_EVENT = 'voyage-new-chat';

export function newChat() {
  window.dispatchEvent(new Event(NEW_CHAT_EVENT));
}
