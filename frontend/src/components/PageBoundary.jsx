/* eslint-disable react/prop-types */
import { Component, createRef } from "react";

// Never automatically reload an active visit or repeat a failed mutation.
export default class PageBoundary extends Component {
  state = { failed: false };
  heading = createRef();
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.heading.current?.focus(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="mp-page"><section className="mp-card" aria-labelledby="page-load-error">
      <h1 id="page-load-error" tabIndex={-1} ref={this.heading}>This page could not load</h1>
      <p>Your connection may have changed, or a new version may be available. Reload when you are ready; any unsaved changes on this page may be lost.</p>
      <p>No booking, payment or clinical action is repeated by this screen.</p>
      <button type="button" className="mp-button mp-button--primary" onClick={() => window.location.reload()}>Reload page</button>
      <p><a href="/">MediPulse home</a></p>
    </section></main>;
  }
}
