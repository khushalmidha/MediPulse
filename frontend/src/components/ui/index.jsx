/* eslint-disable react/prop-types */
import { useEffect, useId, useRef } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Inbox, LoaderCircle, X } from "lucide-react";

export function Button({ children, variant = "primary", size = "normal", to, href, disabled, className = "", type = "button", ...props }) {
  const classes = "mp-button mp-button--" + variant + " mp-button--" + size + " " + className;
  if (to || href) {
    const Tag = to ? Link : "a";
    return <Tag {...props} {...(to ? { to } : { href })} className={classes} aria-disabled={disabled || undefined} tabIndex={disabled ? -1 : props.tabIndex} onClick={disabled ? event => event.preventDefault() : props.onClick}>{children}</Tag>;
  }
  return <button {...props} className={classes} type={type} disabled={disabled}>{children}</button>;
}
export function Card({ as: Tag = "section", className = "", children, ...props }) { return <Tag className={"mp-card " + className} {...props}>{children}</Tag>; }
export function Field({ label, hint, error, as: Tag = "input", id, className = "", required, children, ...props }) {
  const generated = useId(), inputId = id || generated;
  const description = error ? inputId + "-error" : hint ? inputId + "-hint" : undefined;
  return <div className={"mp-field " + className}><label htmlFor={inputId}>{label}{required && <span aria-hidden="true"> *</span>}</label><Tag {...props} id={inputId} required={required} aria-invalid={Boolean(error)} aria-describedby={description} className="mp-input">{children}</Tag>{error ? <p id={description} className="mp-field-error">{error}</p> : hint && <p id={description} className="mp-field-hint">{hint}</p>}</div>;
}
const statusTone = { reserved: "info", booking: "info", waiting: "warning", queued: "warning", vitals_done: "positive", in_consultation: "positive", active: "positive", completed: "neutral", cancelled: "danger", no_show: "neutral", refund_pending: "warning" };
export function StatusBadge({ status, children, tone }) { return <span className={"mp-status mp-status--" + (tone || statusTone[status] || "neutral")}><span aria-hidden="true" className="mp-status-dot" />{children || status?.replaceAll("_", " ") || "Status unavailable"}</span>; }
export function LoadingState({ children = "Loading..." }) { return <div className="mp-loading" role="status"><LoaderCircle aria-hidden="true" size={20} className="mp-spin" />{children}</div>; }
export function EmptyState({ title, children, action }) { return <div className="mp-empty"><span className="mp-empty-icon"><Inbox aria-hidden="true" size={24} /></span><h2>{title}</h2>{children && <p>{children}</p>}{action}</div>; }
export function Banner({ children, action, tone = "error" }) { return <div className={"mp-banner mp-banner--" + tone} role={tone === "error" ? "alert" : "status"}><AlertCircle aria-hidden="true" size={20} /><div>{children}</div>{action}</div>; }
export function DataTable({ caption, columns, rows, rowKey = "_id", empty = "No records yet." }) {
  if (!rows.length) return <EmptyState title={empty} />;
  return <div className="mp-table-scroll" role="region" aria-label={caption} tabIndex={0}><table className="mp-table"><caption>{caption}</caption><thead><tr>{columns.map(column => <th scope="col" key={column.key}>{column.label}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row[rowKey]}>{columns.map(column => <td key={column.key}>{column.render ? column.render(row) : row[column.key]}</td>)}</tr>)}</tbody></table></div>;
}
export function Dialog({ open, onClose, title, children }) {
  const ref = useRef(null), callback = useRef(onClose), titleId = useId();
  callback.current = onClose;
  useEffect(() => {
    if (!open) return undefined;
    const dialog = ref.current, previous = document.activeElement, overflow = document.body.style.overflow;
    dialog.showModal(); document.body.style.overflow = "hidden";
    dialog.querySelector("[data-autofocus]")?.focus();
    return () => { dialog.close(); document.body.style.overflow = overflow; if (previous?.isConnected) previous.focus(); };
  }, [open]);
  return <dialog ref={ref} className="mp-dialog" aria-labelledby={titleId} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const controls = [...ref.current.querySelectorAll('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]')].filter(node => node.getClientRects().length);
    const first = controls[0], last = controls.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={event => { event.preventDefault(); callback.current(); }} onClick={event => {
    if (event.target !== ref.current) return;
    const bounds = ref.current.getBoundingClientRect();
    if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) callback.current();
  }}><div className="mp-dialog-header"><h2 id={titleId}>{title}</h2><Button variant="ghost" aria-label={"Close " + title} onClick={onClose}><X aria-hidden="true" size={20} /></Button></div>{open && children}</dialog>;
}
