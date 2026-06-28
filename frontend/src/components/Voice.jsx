/* eslint-disable react/prop-types */
import { useState } from 'react';
import { getSpeechRecognition } from '../speechRecognition';

const Voice = ({ setNewMessage }) => {
  const [isListening, setIsListening] = useState(false);

  const handleListen = () => {
    const SpeechRecognition = getSpeechRecognition();
    if (!SpeechRecognition) {
      alert('Web Speech API is not supported by this browser.');
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false; 
    recognition.interimResults = false; 
    recognition.lang = 'en-US';

    recognition.onstart = () => setIsListening(true);
    recognition.onend = () => setIsListening(false);

    recognition.onresult = (event) => {
      const transcript = event.results[0][0].transcript;
      setNewMessage(transcript); 
    };

    recognition.onerror = (event) => {
      console.error('Speech recognition error', event.error);
    };

    isListening ? recognition.stop() : recognition.start();
  };

  return (
    <button 
      type="button"
      onClick={handleListen} 
      className="ml-2 p-2 bg-gray-300 rounded-lg hover:bg-gray-400"
    >
      {isListening ? '🎤 Listening...' : '🎤'}
    </button>
  );
};

export default Voice;
