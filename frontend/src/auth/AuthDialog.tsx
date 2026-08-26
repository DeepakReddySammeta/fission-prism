import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { GoogleOAuthProvider, GoogleLogin } from '@react-oauth/google';
import { useAuth } from './AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '@/components/ui/form';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

interface FormValues {
  email: string;
  password: string;
}

export function AuthDialog({
  open, onClose, onSuccess, reason,
}: {
  open: boolean;
  onClose: () => void;
  /** Receives the just-issued token directly — the caller's own `token` from
   * useAuth() is still stale at this point (state hasn't re-rendered yet). */
  onSuccess?: (token: string) => void;
  reason?: string;
}) {
  const { login, signup, loginWithGoogle } = useAuth();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [error, setError] = useState<string | null>(null);
  const form = useForm<FormValues>({ defaultValues: { email: '', password: '' } });

  const finish = (token: string) => {
    onClose();
    onSuccess?.(token);
    form.reset();
  };

  const submit = async (values: FormValues) => {
    setError(null);
    try {
      const result = mode === 'signin'
        ? await login(values.email, values.password)
        : await signup(values.email, values.password);
      finish(result.token);
    } catch (err: any) {
      setError(err.message || 'Something went wrong');
    }
  };

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent className="sm:max-w-[400px] font-sans">
        <DialogHeader>
          <DialogTitle className="font-serif text-xl">{mode === 'signin' ? 'Sign in' : 'Create an account'}</DialogTitle>
          {reason && <DialogDescription>{reason}</DialogDescription>}
        </DialogHeader>

        {GOOGLE_CLIENT_ID && (
          <>
            <div className="flex justify-center">
              <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
                <GoogleLogin
                  theme={document.documentElement.classList.contains('dark') ? 'filled_black' : 'outline'}
                  onSuccess={(cred) => {
                    if (!cred.credential) return;
                    loginWithGoogle(cred.credential)
                      .then((result) => finish(result.token))
                      .catch((err: any) => setError(err.message));
                  }}
                  onError={() => setError('Google sign-in failed')}
                />
              </GoogleOAuthProvider>
            </div>
            <div className="modal-divider"><span>or</span></div>
          </>
        )}

        <Form {...form}>
          <form onSubmit={form.handleSubmit(submit)} className="space-y-4">
            <FormField
              control={form.control}
              name="email"
              rules={{ required: 'Email is required' }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl>
                    <Input type="email" autoComplete="email" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            <FormField
              control={form.control}
              name="password"
              rules={{ required: 'Password is required', minLength: { value: 6, message: 'At least 6 characters' } }}
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Password</FormLabel>
                  <FormControl>
                    <Input type="password" autoComplete="current-password" {...field} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            {error && <p className="text-sm font-medium text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
              {form.formState.isSubmitting ? 'Please wait…' : mode === 'signin' ? 'Sign in' : 'Sign up'}
            </Button>
          </form>
        </Form>

        <p className="text-center text-sm text-muted-foreground">
          {mode === 'signin' ? (
            <>New here? <button type="button" className="link-btn" onClick={() => setMode('signup')}>Create an account</button></>
          ) : (
            <>Already have an account? <button type="button" className="link-btn" onClick={() => setMode('signin')}>Sign in</button></>
          )}
        </p>
      </DialogContent>
    </Dialog>
  );
}
