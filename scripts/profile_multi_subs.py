import sys
from collections import Counter, defaultdict
from profile_legacy_dump import load

d = load(sys.argv[1:])
by_user = defaultdict(list)
for s in d.get('psspace58_mepr_subscriptions', []):
    by_user[s['user_id']].append(s)
multi = {u: sorted(v, key=lambda s: (s['created_at'] or '', int(s['id']))) for u, v in by_user.items() if len(v) > 1}
print('People with more than one subscription: %d' % len(multi))
print('Subscription counts per person:', dict(Counter(len(v) for v in multi.values())))
print('Status order, oldest to newest (counts):')
for pattern, n in Counter(' > '.join(s['status'] for s in v) for v in multi.values()).most_common():
    print('  %3d  %s' % (n, pattern))
def verdict(v):
    active = [s for s in v if s['status'] == 'active']
    if len(active) == 0: return 'no active one'
    if len(active) > 1: return 'MORE THAN ONE ACTIVE (review: possible double billing)'
    return 'one active, and it is the newest' if active[0] is v[-1] else 'one active, but NOT the newest (review)'
print('Verdict (counts):')
for k, n in Counter(verdict(v) for v in multi.values()).most_common():
    print('  %3d  %s' % (n, k))
