import { useMutation } from '@tanstack/react-query';
import { post } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Button, Card } from '../components/ui';
import { ChangePasswordCard } from '../components/PasswordReset';
import { MySessions } from '../admin/pages';
import { PhoneCard } from '../components/PhoneCard';

/** Account settings for every signed-in user: phone number, change password, sessions, sign out everywhere. */
export function MyAccountPage() {
  const { user, logout } = useAuth();
  const all = useMutation({ mutationFn: () => post('/api/auth/logout-all', {}), onSuccess: () => logout().then(() => { window.location.href = '/login'; }) });
  return <section className="mx-auto max-w-3xl space-y-4">
    <h1 className="text-2xl font-bold">Account and security</h1>
    <Card><dl className="grid gap-2 text-sm sm:grid-cols-[8rem_1fr]"><dt className="font-medium">Name</dt><dd>{user!.fullName}</dd><dt className="font-medium">Email</dt><dd>{user!.email}</dd></dl></Card>
    <PhoneCard />
    <ChangePasswordCard />
    <Card><h2 className="mb-2 font-semibold">Where you are signed in</h2><MySessions />
      <p className="mb-3 mt-4 text-sm text-slate-600">Sign out on every device, including this one.</p>
      <Button variant="danger" loading={all.isPending} onClick={() => all.mutate()}>Sign out everywhere</Button></Card>
  </section>;
}
