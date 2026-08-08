/* eslint-disable react/prop-types */
import { useEffect, useState } from "react";
import axios from "axios";
import { AlertTriangle, Save, X } from "lucide-react";
import { BACKEND_URL } from "../utils";





const SoapNoteModal = ({ appointmentId, onClose, soapNote }) => {


  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4 py-6">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-gray-200 px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-gray-950">AI-Generated SOAP Note</h2>
            <p className="mt-1 flex items-center gap-2 text-sm text-blue-700">
              Automatically generated for your review.
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
            <div key={field} className="block">
              <span className="text-sm font-semibold capitalize text-gray-900">{field}</span>
              <div className="mt-2 min-h-24 w-full rounded-md border border-gray-300 bg-gray-50 p-3 text-sm text-gray-800 whitespace-pre-wrap">
                {soapNote?.[field] || "Not discussed"}
              </div>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-gray-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default SoapNoteModal;
