import React from 'react';
import { Cookie as CookieIcon, Shield, Settings, Info, Bell } from 'lucide-react';

const PolicySection = ({ title, icon: Icon, children }) => (
  <section className="bg-white dark:bg-slate-950 p-6 rounded-lg shadow-sm border border-gray-100 hover:shadow-md transition-shadow">
    <div className="flex items-center mb-4">
      <Icon className="w-6 h-6 text-red-600 dark:text-red-500 mr-3" />
      <h2 className="text-xl font-semibold text-gray-900 dark:text-slate-100">{title}</h2>
    </div>
    <div className="text-gray-700 leading-relaxed space-y-4">{children}</div>
  </section>
);

const DataUsagePolicy = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-slate-100 mb-4">
            Cookie <span className="text-red-600 dark:text-red-500">Policy</span>
          </h1>
          <p className="text-gray-600">Last updated: March 17, 2024</p>
        </div>

        <div className="space-y-6">
          <PolicySection title="What Are Cookies" icon={CookieIcon}>
            <p>
              Cookies are small text files that are stored on your device when you visit our website. 
              They help us provide you with a better experience by remembering your preferences 
              and enabling certain features.
            </p>
          </PolicySection>

          <PolicySection title="How We Use Cookies" icon={Settings}>
            <p>We use cookies for:</p>
            <ul className="list-disc list-inside space-y-2 mt-2">
              <li>Essential website functionality</li>
              <li>Remembering your preferences</li>
              <li>Analyzing website traffic and performance</li>
              <li>Improving our services</li>
            </ul>
          </PolicySection>

          <PolicySection title="Types of Cookies" icon={Shield}>
            <div className="space-y-3">
              <div>
                <h3 className="font-medium text-gray-900 dark:text-slate-100">Essential Cookies</h3>
                <p>Required for basic website functionality and security.</p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-slate-100">Preference Cookies</h3>
                <p>Remember your settings and preferences for a better experience.</p>
              </div>
              <div>
                <h3 className="font-medium text-gray-900 dark:text-slate-100">Analytics Cookies</h3>
                <p>Help us understand how visitors interact with our website.</p>
              </div>
            </div>
          </PolicySection>

          <PolicySection title="Managing Cookies" icon={Info}>
            <p>
              You can control cookies through your browser settings. However, disabling certain 
              cookies may limit your ability to use some features of our website.
            </p>
            <div className="mt-4">
              <h3 className="font-medium text-gray-900 dark:text-slate-100 mb-2">Browser Settings:</h3>
              <ul className="list-disc list-inside space-y-2">
                <li>Chrome: Settings → Privacy and Security → Cookies</li>
                <li>Firefox: Options → Privacy & Security → Cookies</li>
                <li>Safari: Preferences → Privacy → Cookies</li>
              </ul>
            </div>
          </PolicySection>
        </div>
      </div>
    </div>
  );
};

export default DataUsagePolicy
;