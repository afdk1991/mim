import { useState } from 'react';
import type { FormEvent } from 'react';
import { t } from '@mim/i18n';
import type { Locale } from '@mim/i18n';
import { api, errorText, setSession } from '../api';
import type { LoginResult, Provider, Region } from '../api';

interface Props {
  onLogin: (result: LoginResult) => void;
}

export function Login({ onLogin }: Props) {
  const [locale, setLocale] = useState<Locale>('zh-CN');
  const [region, setRegion] = useState<Region>('cn');
  const [mode, setMode] = useState<'password' | 'code'>('password');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const provider: Provider = region === 'cn' ? 'phone' : 'email';
  const identifierLabel = provider === 'phone' ? t(locale, 'auth.phone') : t(locale, 'auth.email');

  function switchRegion(next: Region) {
    setRegion(next);
    setIdentifier('');
    setPassword('');
    setCode('');
    setDevCode(null);
    setError(null);
  }

  function switchMode(next: 'password' | 'code') {
    setMode(next);
    setCode('');
    setPassword('');
    setDevCode(null);
    setError(null);
  }

  async function sendCode() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.requestCode(region, provider, identifier.trim());
      setDevCode(result.dev_code);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result =
        mode === 'password'
          ? await api.loginWithPassword({ region, identifier: identifier.trim(), password })
          : await api.login({
              region,
              provider,
              identifier: identifier.trim(),
              code: code.trim(),
            });
      setSession(result);
      onLogin(result);
    } catch (err) {
      setError(errorText(locale, err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card">
        <div className="auth-head">
          <div>
            <h1>{t(locale, 'app.name')}</h1>
            <p className="muted">{t(locale, 'app.tagline')}</p>
          </div>
          <button
            type="button"
            className="btn ghost small"
            onClick={() => setLocale(locale === 'zh-CN' ? 'en-US' : 'zh-CN')}
          >
            {locale === 'zh-CN' ? 'EN' : '中文'}
          </button>
        </div>

        <div className="segmented">
          <button
            type="button"
            className={region === 'cn' ? 'active' : ''}
            onClick={() => switchRegion('cn')}
          >
            中国区
          </button>
          <button
            type="button"
            className={region === 'global' ? 'active' : ''}
            onClick={() => switchRegion('global')}
          >
            Global
          </button>
        </div>

        <div className="segmented">
          <button
            type="button"
            className={mode === 'password' ? 'active' : ''}
            onClick={() => switchMode('password')}
          >
            {t(locale, 'auth.modePassword')}
          </button>
          <button
            type="button"
            className={mode === 'code' ? 'active' : ''}
            onClick={() => switchMode('code')}
          >
            {t(locale, 'auth.modeCode')}
          </button>
        </div>

        <form className="form" onSubmit={submit}>
          <label>
            <span>{identifierLabel}</span>
            <input
              value={identifier}
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder={provider === 'phone' ? '13800138000' : 'you@example.com'}
              autoComplete="username"
              required
            />
          </label>

          {mode === 'password' ? (
            <label>
              <span>{t(locale, 'auth.password')}</span>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
          ) : (
            <label>
              <span>{t(locale, 'auth.code')}</span>
              <div className="row">
                <input
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                  placeholder="000000"
                  inputMode="numeric"
                  maxLength={6}
                  required
                />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={sendCode}
                  disabled={busy || identifier.trim().length === 0}
                >
                  {t(locale, 'auth.sendCode')}
                </button>
              </div>
            </label>
          )}

          {devCode && (
            <p className="dev-code">
              {t(locale, 'auth.codeSent')}: <strong>{devCode}</strong>
            </p>
          )}

          {error && <p className="error">{error}</p>}

          <button type="submit" className="btn primary block" disabled={busy}>
            {busy ? t(locale, 'common.loading') : t(locale, 'auth.login')}
          </button>
        </form>
      </div>
    </div>
  );
}

