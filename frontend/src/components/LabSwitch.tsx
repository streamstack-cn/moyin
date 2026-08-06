import React from 'react';

interface LabSwitchProps {
    checked: boolean;
    onChange: (checked: boolean) => void;
    disabled?: boolean;
}

const LabSwitch: React.FC<LabSwitchProps> = ({ checked, onChange, disabled }) => {
    return (
        <label className="lab-switch" onClick={e => e.stopPropagation()} style={{ 
            opacity: disabled ? 0.5 : 1, 
            pointerEvents: disabled ? 'none' : 'auto', 
            height: '24px', 
            display: 'flex', 
            alignItems: 'center' 
        }}>
            <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
            <div className="lab-slider">
                <div className="lab-circle">
                    <svg className="lab-checkmark" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 4.5l2.5 2.5L9 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    <svg className="lab-cross" viewBox="0 0 6 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M1 1l4 4M5 1L1 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                </div>
            </div>
        </label>
    );
};

export default LabSwitch;
