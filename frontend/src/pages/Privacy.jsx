import React from 'react';
import { Lock, Shield, UserCheck, Bell, Mail } from 'lucide-react';

const PrivacySection = ({ title, icon: Icon, children }) => (
  <section className="bg-white dark:bg-slate-950 p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
    <div className="flex items-center mb-4">
      <Icon className="w-6 h-6 text-blue-600 dark:text-red-500 mr-3" />
      <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
    </div>
    <div className="text-gray-700 leading-relaxed">{children}</div>
  </section>
);

const Privacy = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-slate-100 mb-4">
            Privacy <span className="text-blue-600 dark:text-red-500">Policy</span>
          </h1>
          <p className="text-gray-600">Last updated: March 17, 2024</p>
        </div>

        <div className="space-y-6">
          <PrivacySection title="Introduction" icon={Lock}>
            <p>
              At MediPulse, we take your privacy seriously. This Privacy Policy explains how we collect, 
              use, and protect your personal information when you use our healthcare platform.
            </p>
          </PrivacySection>

          <PrivacySection title="Information We Collect" icon={Shield}>
            <ul className="list-disc list-inside space-y-2">
              <li>Personal identification information (Name, email address, phone number)</li>
              <li>Medical history and health records</li>
              <li>Communication preferences</li>
              <li>Device and usage information</li>
            </ul>
          </PrivacySection>

          <PrivacySection title="How We Use Your Information" icon={Bell}>
            <ul className="list-disc list-inside space-y-2">
              <li>To provide and maintain our healthcare services</li>
              <li>To communicate with you about appointments and updates</li>
              <li>To improve our platform and user experience</li>
              <li>To ensure compliance with healthcare regulations</li>
            </ul>
          </PrivacySection>

          <PrivacySection title="Your Rights" icon={UserCheck}>
            <p className="mb-3">You have the right to:</p>
            <ul className="list-disc list-inside space-y-2">
              <li>Access your personal information</li>
              <li>Request correction of your data</li>
              <li>Request deletion of your data</li>
              <li>Opt-out of marketing communications</li>
            </ul>
          </PrivacySection>
        </div>
      </div>
    </div>
  );
};

export default Privacy;