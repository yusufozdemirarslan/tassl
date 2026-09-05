// Public authentication screens (UI-001 to UI-004, SYS-001, SYS-002)
import { scopedT } from '../scoped'

export const auth = {
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.name': 'Your name',
  'auth.newPassword': 'New password',
  'auth.confirmPassword': 'New password again',
  'auth.or': 'or',
  'auth.signIn.title': 'Sign in to Tassl',
  'auth.signIn.description': 'Use the email address your institution knows you by.',
  'auth.signIn.submit': 'Sign in',
  'auth.signIn.rememberMe': 'Keep me signed in',
  'auth.signIn.forgot': 'Forgot your password?',
  'auth.signIn.noAccount': 'No account yet?',
  'auth.signIn.createAccount': 'Create an account',
  'auth.signIn.google': 'Continue with Google',
  'auth.signUp.title': 'Create your Tassl account',
  'auth.signUp.description': 'One account; your institution then adds you to its courses.',
  'auth.signUp.submit': 'Create account',
  'auth.signUp.passwordHint': '12 to 128 characters',
  'auth.signUp.haveAccount': 'Already have an account?',
  'auth.signUp.signIn': 'Sign in',
  'auth.verify.sentTitle': 'Confirm your email address',
  'auth.verify.sentBody':
    'We sent a confirmation link to {email}. Open it to finish setting up your account; the link works for 24 hours.',
  'auth.verify.sentBodyNoEmail':
    'We sent a confirmation link to your email address. Open it to finish setting up your account; the link works for 24 hours.',
  'auth.verify.verifiedTitle': 'Email address confirmed',
  'auth.verify.verifiedBody': 'Your account is ready.',
  'auth.verify.continue': 'Continue to Tassl',
  'auth.verify.invalidTitle': 'That link no longer works',
  'auth.verify.invalidBody':
    'Confirmation links work once and last 24 hours. Ask for a new one and it arrives in a moment.',
  'auth.verify.resend': 'Resend the link',
  'auth.verify.resendIn': 'Resend the link in {seconds} s',
  'auth.verify.resendSent': 'If that address still needs confirming, a new link is on its way.',
  'auth.verify.backToSignIn': 'Back to sign in',
  'auth.forgot.title': 'Reset your password',
  'auth.forgot.description': 'We email a link that lets you choose a new password.',
  'auth.forgot.submit': 'Email me a link',
  'auth.forgot.sent': 'If that address exists, we sent a link. It works for one hour.',
  'auth.forgot.backToSignIn': 'Back to sign in',
  'auth.reset.title': 'Choose a new password',
  'auth.reset.description': 'Saving a new password signs out every other session.',
  'auth.reset.submit': 'Save the new password',
  'auth.reset.successTitle': 'Password changed',
  'auth.reset.successBody': 'Sign in with your new password.',
  'auth.reset.invalidTitle': 'That reset link no longer works',
  'auth.reset.invalidBody': 'Reset links work once and last one hour. Ask for a new one.',
  'auth.reset.requestNew': 'Ask for a new link',
  'auth.reset.signIn': 'Sign in',
  'auth.validation.email': 'Enter a valid email address.',
  'auth.validation.password': 'Enter your password.',
  'auth.validation.name': 'Enter your name.',
  'auth.validation.nameTooLong': 'Use 120 characters or fewer.',
  'auth.validation.passwordLength': 'Use between 12 and 128 characters.',
  'auth.validation.passwordMismatch': 'Both passwords must be the same.',
  'auth.error.invalidEmailOrPassword': 'That email address and password do not match an account.',
  'auth.error.emailNotVerified': 'Confirm your email address before you sign in.',
  'auth.error.resendVerification': 'Resend verification',
  'auth.error.rateLimited': 'Too many attempts. Try again in {seconds} seconds.',
  'auth.error.rateLimitedNoSeconds': 'Too many attempts. Wait a minute and try again.',
  'auth.error.linkExpired': 'That link has expired or has already been used.',
  'auth.error.generic': 'That did not work. Try again.',
  // Pending labels: with prefers-reduced-motion the spinner is nearly the only sign a call is in
  // flight, so the label says it in words as well (DESIGN.md §Motion).
  'auth.signIn.submitPending': 'Signing in',
  'auth.signUp.submitPending': 'Creating your account',
  'auth.forgot.submitPending': 'Sending the link',
  'auth.reset.submitPending': 'Saving the new password',
  'auth.verify.resendPending': 'Sending the link',
  // The resend cooldown reads as its own line under the control, so the control keeps its label.
  'auth.verify.cooldown': 'You can ask for another link in {seconds} s.',
  // Bare /verify-email: nobody has been sent anything yet, so the screen may not say they have.
  'auth.verify.idleTitle': 'Confirm your email address',
  'auth.verify.idleBody':
    'Enter the address you signed up with and we send a new confirmation link.',
  'auth.verify.sentBodyAddressed':
    'Open the link to finish setting up your account; it works for 24 hours. We sent it to:',
  'auth.reset.backToSignIn': 'Back to sign in',
} as const

/** `t` over this namespace alone; the key is still the full dotted key. */
export const t = scopedT(auth)
