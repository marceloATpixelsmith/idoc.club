export function AuthPendingLabel({ text }: { text: string }) {
  return (
    <span className="idoc-auth-button__pending">
      {text}
      <span aria-hidden="true" className="idoc-auth-button__dots">
        <span className="idoc-auth-button__dot" />
        <span className="idoc-auth-button__dot" />
        <span className="idoc-auth-button__dot" />
      </span>
    </span>
  );
}
