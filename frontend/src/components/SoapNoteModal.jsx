/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { AlertTriangle, Save, X } from "lucide-react";
import { BACKEND_URL } from "../utils";

const emptySoap = {
  subjective: "",
  objective: "",
  assessment: "",
  plan: "",
};

const buildCombinedNotes = (soapNote) => `SOAP Note

Subjective:
${soapNote.subjective || "Not discussed"}

Objective:
${soapNote.objective || "Not discussed"}

Assessment:
${soapNote.assessment || "Preliminary AI assessment: Not clearly established."}

Plan:
${soapNote.plan || "Not discussed"}`;

const SoapNoteModal = ({ appointmentId, onClose, onSaved, soapNote }) => {
  const [draft, setDraft] = useState(emptySoap);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setDraft({
      subjective: soapNote?.subjective || "",
      objective: soapNote?.objective || "",
      assessment: soapNote?.assessment || "",
      plan: soapNote?.plan || "",
    });
  }, [soapNote]);

  const updateField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }));
  };

  const saveSoap = async () => {
    setSaving(true);
    setError("");
    try {
      const response = await axios.patch(
        `${BACKEND_URL}/appointment/${appointmentId}/notes`,
        {
          doctorNotes: buildCombinedNotes(draft),
          soapNote: { ...draft, generatedBy: "doctor" },
        },
        { withCredentials: true },
      );
      onSaved?.(response.data.soapNote || draft);
      onClose();
    } catch (err) {
      setError(err.response?.data?.message || "Could not save SOAP note");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-950">AI-Generated SOAP Note</h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-amber-700">
              <AlertTriangle className="h-4 w-4" />
              Preliminary AI assessment - doctor review required before sharing.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
            title="Close SOAP note"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {["subjective", "objective", "assessment", "plan"].map((field) => (
            <label key={field} className="block">
              <span className="text-sm font-semibold capitalize text-gray-900">{field}</span>
              <textarea
                value={draft[field]}
                onChange={(event) => updateField(field, event.target.value)}
                className="mt-2 min-h-24 w-full rounded-md border border-gray-300 p-3 text-sm outline-none focus:border-blue-500"
                placeholder="Not discussed"
              />
            </label>
          ))}
          {error && (
            <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
              {error}
            </div>
          )}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Review Later
          </button>
          <button
            type="button"
            onClick={saveSoap}
            disabled={saving}
            className="flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-gray-400"
          >
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save SOAP Note"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SoapNoteModal;
