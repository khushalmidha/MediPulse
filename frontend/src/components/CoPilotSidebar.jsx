/* eslint-disable react/prop-types */
import { useEffect, useRef } from "react";
import {
  AlertTriangle,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Info,
  Loader2,
  ShieldAlert,
} from "lucide-react";

const typeStyles = {
  RED_FLAG: {
    label: "Red flag",
    icon: ShieldAlert,
    className: "border-red-200 bg-red-50 text-red-950",
    badge: "bg-red-100 text-red-700",
  },
  DRUG_ALERT: {
    label: "Drug alert",
    icon: AlertTriangle,
    className: "border-amber-200 bg-amber-50 text-amber-950",
    badge: "bg-amber-100 text-amber-800",
  },
  GUIDELINE: {
    label: "Guideline",
    icon: ClipboardList,
    className: "border-red-200 bg-red-50 text-blue-950",
    badge: "bg-red-100 text-blue-800",
  },
  INFO: {
    label: "Info",
    icon: Info,
    className: "border-gray-200 dark:border-red-900/40 bg-gray-50 dark:bg-slate-900 text-gray-900 dark:text-slate-100",
    badge: "bg-gray-200 text-gray-700",
  },
};

const formatTime = (timestamp) => {
  if (!timestamp) return "now";
  const diffMs = Date.now() - new Date(timestamp).getTime();
  const diffMin = Math.max(0, Math.floor(diffMs / 60000));
  if (diffMin < 1) return "now";
  return `${diffMin} min ago`;
};

const CoPilotSidebar = ({
  collapsed,
  isActive,
  isGenerating,
  onGenerateSoap,
  onToggle,
  suggestions,
  voiceUnavailable,
}) => {
  const endRef = useRef(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [suggestions.length, collapsed]);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-blue-800 hover:bg-red-100 xl:w-12 xl:flex-col"
        title="Open AI Co-Pilot"
      >
        <BrainCircuit className="h-5 w-5" />
        <ChevronLeft className="hidden h-4 w-4 xl:block" />
        <span className="xl:hidden">AI Co-Pilot</span>
      </button>
    );
  }

  return (
    <aside className="flex h-full min-h-80 flex-col rounded-lg border border-gray-200 dark:border-red-900/40 bg-white dark:bg-slate-950 shadow-sm xl:w-80">
      <div className="flex items-center justify-between border-b border-gray-200 dark:border-red-900/40 px-4 py-3">
        <div>
          <div className="flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-blue-700" />
            <h3 className="text-sm font-bold text-gray-950">AI Co-Pilot</h3>
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-gray-500">
            <span
              className={`h-2 w-2 rounded-full ${
                isActive && !voiceUnavailable ? "bg-green-500" : "bg-gray-300"
              }`}
            />
            {voiceUnavailable ? "Voice capture unavailable" : isActive ? "Live" : "Standby"}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-slate-100"
          title="Collapse AI Co-Pilot"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      {voiceUnavailable && (
        <div className="m-3 rounded-md border border-gray-200 dark:border-red-900/40 bg-gray-50 dark:bg-slate-900 p-3 text-xs text-gray-600">
          Voice capture unavailable in this browser. Co-Pilot requires Chrome or Edge.
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {suggestions.length === 0 ? (
          <div className="rounded-md border border-dashed border-gray-300 p-4 text-sm text-gray-500">
            Live suggestions will appear here when something needs the doctor&apos;s attention.
          </div>
        ) : (
          suggestions.map((suggestion) => {
            const style = typeStyles[suggestion.type] || typeStyles.INFO;
            const Icon = style.icon;
            return (
              <div
                key={suggestion.id || `${suggestion.type}-${suggestion.timestamp}-${suggestion.message}`}
                className={`rounded-md border p-3 text-sm ${style.className}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs font-bold ${style.badge}`}>
                    <Icon className="h-3.5 w-3.5" />
                    {style.label}
                  </span>
                  <span className="text-xs text-gray-500">{formatTime(suggestion.timestamp)}</span>
                </div>
                <p className="mt-2 whitespace-pre-line leading-5">{suggestion.message}</p>
                <p className="mt-2 text-[11px] font-medium text-gray-500">
                  AI suggestion - clinical judgment required.
                </p>
              </div>
            );
          })
        )}
        <div ref={endRef} />
      </div>

      <div className="border-t border-gray-200 dark:border-red-900/40 p-3">
        <button
          type="button"
          onClick={onGenerateSoap}
          disabled={isGenerating}
          className="flex w-full items-center justify-center gap-2 rounded-md bg-red-600 dark:bg-red-700 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-400"
        >
          {isGenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <ClipboardList className="h-4 w-4" />}
          Generate SOAP Notes
        </button>
      </div>
    </aside>
  );
};

export default CoPilotSidebar;
