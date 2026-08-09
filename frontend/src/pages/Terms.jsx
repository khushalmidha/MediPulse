import React from 'react';
import { FileText, Shield, UserCheck, AlertCircle, Scale } from 'lucide-react';

const TermsSection = ({ title, icon: Icon, children }) => (
  <section className="bg-white dark:bg-slate-950 p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
    <div className="flex items-center mb-4">
      <Icon className="w-6 h-6 text-red-600 dark:text-red-500 mr-3" />
      <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
    </div>
    <div className="text-gray-700 leading-relaxed space-y-4">{children}</div>
  </section>
);

const Terms = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-slate-100 mb-4">
            Terms of <span className="text-red-600 dark:text-red-500">Service</span>
          </h1>
          <p className="text-gray-600">Last updated: March 17, 2024</p>
        </div>

        <div className="space-y-6">
          <TermsSection title="Agreement to Terms" icon={FileText}>
            <p>
              By accessing and using MediPulse, you agree to be bound by these Terms of Service. 
              If you disagree with any part of these terms, you may not access our service.
            </p>
          </TermsSection>

          <TermsSection title="Privacy Policy" icon={Shield}>
            <p>
              Your use of MediPulse is also governed by our Privacy Policy. Please review our 
              Privacy Policy, which outlines how we collect, use, and protect your personal information.
            </p>
          </TermsSection>

          <TermsSection title="User Responsibilities" icon={UserCheck}>
            <ul className="list-disc list-inside space-y-2">
              <li>Provide accurate and complete information</li>
              <li>Maintain the security of your account</li>
              <li>Respect the privacy of other users</li>
              <li>Use the platform in compliance with applicable laws</li>
            </ul>
          </TermsSection>

          <TermsSection title="Platform Usage" icon={AlertCircle}>
            <p>Users must not:</p>
            <ul className="list-disc list-inside space-y-2 mt-2">
              <li>Share false or misleading information</li>
              <li>Attempt to gain unauthorized access to the platform</li>
              <li>Use the service for any illegal purposes</li>
              <li>Interfere with the proper functioning of the platform</li>
            </ul>
          </TermsSection>

        </div>
      </div>
    </div>
  );
};

export default Terms;