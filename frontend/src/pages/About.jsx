import React from 'react';
import { FaGithub, FaLinkedin, FaTwitter } from 'react-icons/fa';

const About = () => {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-blue-50 py-16 px-4 sm:px-6 lg:px-8">
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-16">
          <h1 className="text-4xl font-extrabold text-gray-900 dark:text-slate-100 mb-4">
            About <span className="text-red-600 dark:text-red-500">MediPulse</span>
          </h1>
          <div className="max-w-3xl mx-auto">
            <p className="text-lg text-gray-700 leading-relaxed">
              MediPulse is a comprehensive healthcare platform designed to connect patients with doctors, 
              manage medical records, and provide access to healthcare communities. Our mission is to make 
              healthcare more accessible and efficient for everyone.
            </p>
          </div>
        </div>
        
        <div className="mb-16">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-slate-100 text-center mb-12">
            Meet Our <span className="text-red-600 dark:text-red-500">Team</span>
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 max-w-5xl mx-auto">
            <div className="bg-white dark:bg-slate-950 p-8 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-red-600 dark:bg-red-700 rounded-full opacity-10"></div>
                <img
                  src="lakshya.jpeg"
                  alt="Lakshya"
                  className="w-40 h-40 rounded-full mx-auto border-4 border-white shadow-lg"
                />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Lakshya Agarwal</h3>
              <p className="text-red-600 dark:text-red-500 font-medium mb-4">Full Stack Developer</p>
              <p className="text-gray-600 mb-6">Passionate about creating seamless user experiences and robust backend solutions.</p>
              <div className="flex justify-center space-x-6">
                <a href="https://github.com/Lakshya0000" target="_blank" rel="noopener noreferrer" className="transform hover:scale-110 transition-transform">
                  <FaGithub className="text-gray-700 hover:text-red-600 dark:text-red-500" size={28} />
                </a>
                <a href="https://www.linkedin.com/in/lakshya-agarwal-98341b287/" target="_blank" rel="noopener noreferrer" className="transform hover:scale-110 transition-transform">
                  <FaLinkedin className="text-gray-700 hover:text-red-600 dark:text-red-500" size={28} />
                </a>
                <a href="https://x.com/Lakshya81001405" target="_blank" rel="noopener noreferrer" className="transform hover:scale-110 transition-transform">
                  <FaTwitter className="text-gray-700 hover:text-red-600 dark:text-red-500" size={28} />
                </a>
              </div>
            </div>
            
            <div className="bg-white dark:bg-slate-950 p-8 rounded-xl shadow-lg transform hover:scale-105 transition-transform duration-300">
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-red-600 dark:bg-red-700 rounded-full opacity-10"></div>
                <img
                  src="Khushal_img.jpeg"
                  alt="Khushal"
                  className="w-40 h-40 rounded-full mx-auto border-4 border-white shadow-lg"
                />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-2">Khushal Midha</h3>
              <p className="text-red-600 dark:text-red-500 font-medium mb-4">Full Stack Developer</p>
              <p className="text-gray-600 mb-6">Specialized in building scalable applications and innovative solutions.</p>
              <div className="flex justify-center space-x-6">
                <a href="https://github.com/khushalmidha" target="_blank" rel="noopener noreferrer" className="transform hover:scale-110 transition-transform">
                  <FaGithub className="text-gray-700 hover:text-red-600 dark:text-red-500" size={28} />
                </a>
                <a href="https://www.linkedin.com/in/khushal-midha-260bb3288/" target="_blank" rel="noopener noreferrer" className="transform hover:scale-110 transition-transform">
                  <FaLinkedin className="text-gray-700 hover:text-red-600 dark:text-red-500" size={28} />
                </a>
                <a href="https://x.com/Khushal_Midha" target="_blank" rel="noopener noreferrer" className="transform hover:scale-110 transition-transform">
                  <FaTwitter className="text-gray-700 hover:text-red-600 dark:text-red-500" size={28} />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default About;