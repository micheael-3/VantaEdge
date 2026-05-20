import { useEffect } from 'react';
import { Navigate, useParams } from 'react-router-dom';
import { storeReferralCode } from '../lib/referral';

export default function RefCapture() {
  const { code } = useParams();

  useEffect(() => {
    if (code) storeReferralCode(code);
  }, [code]);

  // Bounce straight to register — the code lives in localStorage for 30 days.
  return <Navigate to="/register" replace />;
}
