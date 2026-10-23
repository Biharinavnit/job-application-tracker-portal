import React, { useState } from 'react';

export default function PasswordInput(props) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="password-input-wrapper">
      <input {...props} className={`form-input${props.className ? ` ${props.className}` : ''}`} type={visible ? 'text' : 'password'} />
      <button
        className="password-visibility-toggle"
        type="button"
        aria-label={visible ? 'Hide password' : 'Show password'}
        aria-pressed={visible}
        onClick={() => setVisible((current) => !current)}
      >
        {visible ? (
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M3 3l18 18M10.6 10.6a2 2 0 002.8 2.8" />
            <path d="M9.9 5.2A10.8 10.8 0 0112 5c5 0 8.5 4.5 9.5 7-.4 1-1.3 2.3-2.6 3.5M6.2 6.2C3.8 7.7 2.5 10 2.5 12c1 2.5 4.5 7 9.5 7 1.1 0 2.1-.2 3.1-.6" />
          </svg>
        ) : (
          <svg aria-hidden="true" focusable="false" viewBox="0 0 24 24">
            <path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z" />
            <circle cx="12" cy="12" r="2.5" />
          </svg>
        )}
      </button>
    </div>
  );
}
