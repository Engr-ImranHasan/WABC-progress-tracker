import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Languages,
  Lock,
  ShieldAlert,
  ShieldCheck,
  UserCheck,
} from 'lucide-react';

const SESSION_KEY = 'wabc_portal_auth_v1';
const AUTH_SALT = 'wabc_dsip_wd02_imran_';
const EXPECTED_HASH =
  'e812f7383f8414943c985f0e7e9973ea80220cd26f4bcebdf31d21ceeca07b10';
const SESSION_TOKEN = 'imran_approved_e812f738';

export const LOCK_PORTAL_EVENT = 'wabc-lock-portal';

/**
 * Pure-JS SHA-256 fallback so verification works reliably across HTTPS, HTTP, and localhost.
 */
function sha256Fallback(ascii: string): string {
  const rightRotate = (value: number, amount: number) =>
    (value >>> amount) | (value << (32 - amount));

  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words: number[] = [];
  const asciiBitLength = ascii.length * 8;

  const hash: number[] = [];
  const k: number[] = [];
  let primeCounter = 0;

  const isComposite: Record<number, boolean> = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) {
        isComposite[i] = true;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }

  let padded = ascii + '\x80';
  while ((padded.length % 64) - 56) padded += '\x00';
  for (let i = 0; i < padded.length; i++) {
    const j = padded.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << (((3 - i) % 4) * 8);
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;

  for (let j = 0; j < words.length; ) {
    const w = words.slice(j, (j += 16));
    const oldHash = hash.slice(0);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15];
      const w2 = w[i - 2];
      const a = hash[0];
      const e = hash[4];
      const temp1 =
        hash[7] +
        (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25)) +
        ((e & hash[5]) ^ (~e & hash[6])) +
        k[i] +
        (w[i] =
          i < 16
            ? w[i]
            : (w[i - 16] +
                (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3)) +
                w[i - 7] +
                (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))) |
              0);
      const temp2 =
        (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22)) +
        ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash[7] = hash[6];
      hash[6] = hash[5];
      hash[5] = hash[4];
      hash[4] = (hash[3] + temp1) | 0;
      hash[3] = hash[2];
      hash[2] = hash[1];
      hash[1] = hash[0];
      hash[0] = (temp1 + temp2) | 0;
    }
    for (let i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }

  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += (b < 16 ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

async function computeSaltedHash(password: string): Promise<string> {
  const payload = AUTH_SALT + password;
  if (typeof window !== 'undefined' && window.crypto?.subtle) {
    try {
      const buf = await window.crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(payload)
      );
      return Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
    } catch {
      // Fallback below
    }
  }
  return sha256Fallback(payload);
}

function readSessionAuthorized(): boolean {
  try {
    return sessionStorage.getItem(SESSION_KEY) === SESSION_TOKEN;
  } catch {
    return false;
  }
}

export const AccessGate: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [unlocked, setUnlocked] = useState<boolean>(readSessionAuthorized);
  const [password, setPassword] = useState<string>('');
  const [showPwd, setShowPwd] = useState<boolean>(false);
  const [phase, setPhase] = useState<
    'idle' | 'verifying' | 'granted' | 'denied'
  >('idle');
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [shakeKey, setShakeKey] = useState<number>(0);
  const [isBn, setIsBn] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const onLock = () => {
      try {
        sessionStorage.removeItem(SESSION_KEY);
      } catch {
        // Ignore storage error
      }
      setUnlocked(false);
      setPassword('');
      setPhase('idle');
      setErrorMsg('');
    };
    window.addEventListener(LOCK_PORTAL_EVENT, onLock);
    return () => window.removeEventListener(LOCK_PORTAL_EVENT, onLock);
  }, []);

  useEffect(() => {
    if (!unlocked) {
      inputRef.current?.focus();
    }
  }, [unlocked]);

  if (unlocked) {
    return <>{children}</>;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (phase === 'verifying' || phase === 'granted') return;

    const trimmed = password.trim();
    if (!trimmed) {
      setPhase('denied');
      setErrorMsg(
        isBn
          ? 'প্রবেশের জন্য অনুগ্রহ করে অ্যাডমিন পাসওয়ার্ড দিন।'
          : 'Passcode required. Enter the access password issued by Engr. Imran Hasan.'
      );
      setShakeKey((k) => k + 1);
      inputRef.current?.focus();
      return;
    }

    setPhase('verifying');
    setErrorMsg('');

    const digest = await computeSaltedHash(password);
    // Brief verification pause to reflect live admin authorization check
    await new Promise((r) => setTimeout(r, 380));

    if (digest === EXPECTED_HASH) {
      setPhase('granted');
      try {
        sessionStorage.setItem(SESSION_KEY, SESSION_TOKEN);
      } catch {
        // Ignore storage errors in private mode
      }
      setTimeout(() => {
        setUnlocked(true);
      }, 650);
    } else {
      setPhase('denied');
      setErrorMsg(
        isBn
          ? 'ভুল পাসওয়ার্ড! শুধু অনুমোদিত ব্যবহারকারীরাই এই পোর্টালে কাজ করতে পারবেন।'
          : 'Access Denied — Invalid passcode. Only authorized personnel approved by Engr. Imran Hasan may enter.'
      );
      setShakeKey((k) => k + 1);
      setPassword('');
      setTimeout(() => inputRef.current?.focus(), 40);
    }
  };

  return (
    <div
      data-testid="access-gate-screen"
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-slate-950 px-4 py-8 text-slate-100 select-none"
    >
      <style>{`
        @keyframes wabcShake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-8px); }
          40% { transform: translateX(8px); }
          60% { transform: translateX(-5px); }
          80% { transform: translateX(5px); }
        }
        .wabc-shake { animation: wabcShake 0.36s cubic-bezier(.36,.07,.19,.97) both; }
      `}</style>

      {/* Blueprint Engineering Grid Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgba(56,189,248,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(56,189,248,0.18) 1px, transparent 1px)',
          backgroundSize: '36px 36px',
        }}
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[720px] -translate-x-1/2 rounded-full bg-blue-600/15 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-40 right-1/4 h-[380px] w-[520px] rounded-full bg-emerald-500/10 blur-3xl"
      />

      {/* Language Toggle Top-Right */}
      <button
        type="button"
        onClick={() => setIsBn((v) => !v)}
        className="absolute right-5 top-5 z-20 flex items-center gap-1.5 rounded-lg border border-slate-700/80 bg-slate-900/85 px-3 py-1.5 text-xs font-semibold text-slate-200 shadow-lg backdrop-blur-md transition hover:border-sky-500/60 hover:text-white"
      >
        <Languages className="h-3.5 w-3.5 text-sky-400" />
        {isBn ? 'English' : 'বাংলা'}
      </button>

      {/* Main Authorization Card */}
      <div
        key={shakeKey}
        className={`relative z-10 w-full max-w-[460px] rounded-2xl border bg-slate-900/90 p-6 sm:p-7 shadow-2xl backdrop-blur-xl transition-colors ${
          phase === 'granted'
            ? 'border-emerald-500/70 ring-2 ring-emerald-500/25'
            : phase === 'denied'
            ? 'wabc-shake border-rose-500/70 ring-2 ring-rose-500/20'
            : 'border-slate-700/80 ring-1 ring-white/10'
        }`}
      >
        {/* Top Project Pill */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-500/40 bg-sky-500/10 px-2.5 py-1 text-[10px] font-bold tracking-wider text-sky-300 uppercase">
            <Lock className="h-3 w-3 shrink-0" />
            {isBn ? 'সংরক্ষিত পোর্টাল • WD-02' : 'RESTRICTED PORTAL • WD-02'}
          </span>

          <span
            className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[10px] font-bold ${
              phase === 'granted'
                ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
                : phase === 'denied'
                ? 'bg-rose-500/15 text-rose-300 border border-rose-500/40'
                : 'bg-amber-500/15 text-amber-300 border border-amber-500/35'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                phase === 'granted'
                  ? 'bg-emerald-400'
                  : phase === 'denied'
                  ? 'bg-rose-400'
                  : 'animate-pulse bg-amber-400'
              }`}
            />
            {phase === 'granted'
              ? isBn
                ? 'অনুমোদন গৃহীত'
                : 'Access Approved'
              : phase === 'denied'
              ? isBn
                ? 'প্রবেশ নিষিদ্ধ'
                : 'Access Denied'
              : isBn
              ? 'অনুমোদন প্রয়োজন'
              : 'Authorization Required'}
          </span>
        </div>

        {/* Title & Engineering Identity */}
        <div className="mb-5 text-center">
          <div
            className={`mx-auto mb-3.5 flex h-14 w-14 items-center justify-center rounded-2xl border shadow-inner transition-all ${
              phase === 'granted'
                ? 'border-emerald-400/60 bg-emerald-500/20 text-emerald-300'
                : phase === 'denied'
                ? 'border-rose-400/60 bg-rose-500/20 text-rose-300'
                : 'border-sky-400/40 bg-sky-500/15 text-sky-300'
            }`}
          >
            {phase === 'granted' ? (
              <ShieldCheck className="h-7 w-7" />
            ) : phase === 'denied' ? (
              <ShieldAlert className="h-7 w-7" />
            ) : (
              <Lock className="h-7 w-7" />
            )}
          </div>

          <h1 className="text-xl font-extrabold tracking-tight text-white">
            WABC Progress Studio
          </h1>
          <p className="mt-1 text-xs font-medium text-slate-400">
            {isBn
              ? 'ঢাকা স্যানিটেশন ইম্প্রুভমেন্ট প্রজেক্ট (DSIP) — প্যাকেজ WD-02'
              : 'Dhaka Sanitation Improvement Project (DSIP) — Package WD-02'}
          </p>
        </div>

        {/* Admin Control Approval Banner */}
        <div className="mb-5 rounded-xl border border-slate-700/80 bg-slate-800/70 px-3.5 py-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/40 bg-emerald-500/15 text-emerald-300">
              <UserCheck className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                {isBn ? 'অ্যাক্সেস নিয়ন্ত্রণকারী অ্যাডমিন' : 'Access Controlled By'}
              </div>
              <div className="truncate text-xs font-bold text-white">
                Engr. Imran Hasan{' '}
                <span className="font-medium text-emerald-300">
                  • {isBn ? 'সাইট অ্যাডমিন' : 'System Administrator'}
                </span>
              </div>
            </div>
          </div>
          <p className="mt-2 border-t border-slate-700/60 pt-2 text-[11px] leading-relaxed text-slate-300">
            {isBn
              ? 'এই প্রজেক্টের অগ্রগতি, AutoCAD ও GIS ডাটা সুরক্ষিত। একমাত্র অ্যাডমিনের অনুমোদিত পাসওয়ার্ড দিয়েই মূল ওয়ার্কস্পেসে প্রবেশ করা যাবে।'
              : 'Project progress, AutoCAD & GIS records are protected. Only authorized access approved by the administrator can unlock this workspace.'}
          </p>
        </div>

        {/* Password Form */}
        <form onSubmit={handleSubmit} className="space-y-3.5">
          <div>
            <label
              htmlFor="wabc-access-password"
              className="mb-1.5 block text-xs font-bold text-slate-200"
            >
              {isBn ? 'অ্যাক্সেস পাসওয়ার্ড লিখুন' : 'Administrator Access Password'}
            </label>
            <div className="relative">
              <input
                ref={inputRef}
                id="wabc-access-password"
                data-testid="access-password-input"
                type={showPwd ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (phase === 'denied') {
                    setPhase('idle');
                    setErrorMsg('');
                  }
                }}
                disabled={phase === 'verifying' || phase === 'granted'}
                autoComplete="current-password"
                placeholder={
                  isBn ? 'পাসওয়ার্ড দিন...' : 'Enter authorized passcode...'
                }
                className={`w-full rounded-xl border bg-slate-950/90 py-2.5 pl-3.5 pr-10 text-sm text-white placeholder-slate-500 outline-none transition ${
                  phase === 'denied'
                    ? 'border-rose-500/80 focus:border-rose-400 focus:ring-2 focus:ring-rose-500/25'
                    : phase === 'granted'
                    ? 'border-emerald-500/80 text-emerald-200'
                    : 'border-slate-700 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/25'
                }`}
              />
              <button
                type="button"
                onClick={() => setShowPwd((v) => !v)}
                aria-label={showPwd ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
              >
                {showPwd ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </div>

          {/* Feedback Area */}
          {errorMsg && (
            <div
              data-testid="access-error-msg"
              className="flex items-start gap-2 rounded-lg border border-rose-500/50 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-200"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-400" />
              <span>{errorMsg}</span>
            </div>
          )}

          {phase === 'granted' && (
            <div
              data-testid="access-granted-msg"
              className="flex items-center gap-2 rounded-lg border border-emerald-500/50 bg-emerald-500/15 px-3 py-2 text-xs font-bold text-emerald-200"
            >
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-400" />
              <span>
                {isBn
                  ? 'Engr. Imran Hasan কর্তৃক অ্যাক্সেস অনুমোদিত — ওয়ার্কস্পেস খুলছে...'
                  : 'Access Granted by Engr. Imran Hasan — Opening Workspace...'}
              </span>
            </div>
          )}

          <button
            type="submit"
            data-testid="access-submit-btn"
            disabled={phase === 'verifying' || phase === 'granted'}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold text-white shadow-lg transition ${
              phase === 'granted'
                ? 'bg-emerald-600 shadow-emerald-900/40'
                : phase === 'verifying'
                ? 'cursor-wait bg-sky-700 opacity-90'
                : 'bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 active:scale-[0.99] shadow-blue-950/50'
            }`}
          >
            {phase === 'verifying' ? (
              <>
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                <span>
                  {isBn
                    ? 'অ্যাডমিন অনুমতি যাচাই হচ্ছে...'
                    : 'Requesting Admin Authorization...'}
                </span>
              </>
            ) : phase === 'granted' ? (
              <>
                <ShieldCheck className="h-4 w-4" />
                <span>
                  {isBn ? 'প্রবেশ অনুমোদিত ✓' : 'Authorization Confirmed ✓'}
                </span>
              </>
            ) : (
              <>
                <span>
                  {isBn
                    ? 'ভেরিফাই করে প্রবেশ করুন'
                    : 'Verify & Enter Workspace'}
                </span>
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <div className="mt-5 border-t border-slate-800 pt-3 text-center text-[10.5px] font-medium text-slate-500">
          Client: DWASA • Contractor: CCECC-SafBon-SMEDI JV • Protected Access
        </div>
      </div>
    </div>
  );
};
