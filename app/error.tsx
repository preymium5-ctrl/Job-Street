"use client";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="container error-page">
      <span className="eyebrow">A brief pause</span>
      <h1>
        Let’s try
        <br />
        that again.
      </h1>
      <p>We couldn’t load this page. Please try again in a moment.</p>
      <button className="button button-primary" onClick={reset}>
        Try again ↗
      </button>
    </div>
  );
}
