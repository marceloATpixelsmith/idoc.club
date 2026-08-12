import { getUser } from '@/lib/db/queries';
import { requireAccountAccess } from '@/lib/membership/data-access';

export async function GET() {
  try {
    await requireAccountAccess('profile');
  } catch {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const user = await getUser();
  return Response.json(user ? { email: user.email, id: user.id, name: user.name } : null);
}
