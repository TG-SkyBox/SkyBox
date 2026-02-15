import React, { useState } from 'react';
import QrWithLogo from '../components/QrWithLogo';

const QrDemoPage = () => {
  const [qrValue, setQrValue] = useState('tg://login?token=example_token_here');
  const [size, setSize] = useState(768);
  const [logoScale, setLogoScale] = useState(0.18);
  const [paddingScale, setPaddingScale] = useState(0.20);
  const [shape, setShape] = useState<'circle' | 'rounded'>('circle');
  const [fileName, setFileName] = useState('qr_with_logo.png');

  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-4xl mx-auto">
        <h1 className="text-3xl font-bold text-foreground mb-8">QR Code with Logo Demo</h1>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* QR Code Display */}
          <div className="bg-card p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Generated QR Code</h2>
            <div className="flex justify-center">
              <QrWithLogo
                value={qrValue}
                size={size}
                logoScale={logoScale}
                paddingScale={paddingScale}
                shape={shape}
                downloadFileName={fileName}
              />
            </div>
          </div>
          
          {/* Controls */}
          <div className="bg-card p-6 rounded-lg shadow-md">
            <h2 className="text-xl font-semibold mb-4">Configuration</h2>
            
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">QR Value</label>
                <input
                  type="text"
                  value={qrValue}
                  onChange={(e) => setQrValue(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                  placeholder="Enter QR code value"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Size: {size}px</label>
                <input
                  type="range"
                  min="256"
                  max="1024"
                  value={size}
                  onChange={(e) => setSize(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Logo Scale: {(logoScale * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min="0.05"
                  max="0.25"
                  step="0.01"
                  value={logoScale}
                  onChange={(e) => setLogoScale(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Padding Scale: {(paddingScale * 100).toFixed(0)}%</label>
                <input
                  type="range"
                  min="0.05"
                  max="0.5"
                  step="0.01"
                  value={paddingScale}
                  onChange={(e) => setPaddingScale(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Shape</label>
                <div className="flex space-x-4">
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="shape"
                      checked={shape === 'circle'}
                      onChange={() => setShape('circle')}
                      className="mr-2"
                    />
                    Circle
                  </label>
                  <label className="flex items-center">
                    <input
                      type="radio"
                      name="shape"
                      checked={shape === 'rounded'}
                      onChange={() => setShape('rounded')}
                      className="mr-2"
                    />
                    Rounded
                  </label>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Download Filename</label>
                <input
                  type="text"
                  value={fileName}
                  onChange={(e) => setFileName(e.target.value)}
                  className="w-full px-3 py-2 border border-input rounded-md bg-background text-foreground"
                  placeholder="Download filename"
                />
              </div>
            </div>
          </div>
        </div>
        
        <div className="mt-8 bg-card p-6 rounded-lg shadow-md">
          <h2 className="text-xl font-semibold mb-4">How It Works</h2>
          <ul className="list-disc pl-5 space-y-2">
            <li>Error Correction Level H ensures the QR code remains scannable even with the central logo</li>
            <li>A white "knockout" area is drawn beneath the logo to prevent interference with QR data</li>
            <li>Logo size is kept within 15-20% of QR width to maintain scanning reliability</li>
            <li>Minimum size of 256px ensures high resolution for reliable scanning</li>
            <li>Canvas-based rendering preserves quality and allows precise control</li>
          </ul>
        </div>
      </div>
    </div>
  );
};

export default QrDemoPage;