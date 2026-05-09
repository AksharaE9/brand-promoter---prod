import React from 'react';

const Loader = ({ message = 'Loading...', size = 'medium', fullPage = false }) => {
  const spinnerClass = size === 'large' ? 'os-spinner-large' : 'os-spinner';
  
  const content = (
    <div className="os-loader-container">
      <div className={spinnerClass}></div>
      {message && <div className="text-sm font-medium text-[#6b7895] animate-pulse">{message}</div>}
    </div>
  );

  if (fullPage) {
    return (
      <div className="fixed inset-0 bg-white/80 backdrop-blur-sm z-[9999] flex items-center justify-center">
        {content}
      </div>
    );
  }

  return content;
};

export default Loader;
