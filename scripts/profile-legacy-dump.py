#!/usr/bin/env python3
"""Read-only profile of the legacy WordPress/MemberPress dumps. Prints AGGREGATE COUNTS ONLY:
no names, emails, hashes, IDs or other personal data. Usage: python3 profile_legacy_dump.py USERS.sql MEPR.sql"""
import re, sys, datetime
from collections import Counter

def parse_dump(path):
    """Yield (table, columns, row_tuple) for every INSERT row. Handles '' and backslash escapes."""
    text = open(path, encoding='utf-8', errors='replace').read()
    cols_by_table = {}
    for m in re.finditer(r'CREATE TABLE `([^`]+)` \((.*?)\n\)', text, re.S):
        cols_by_table[m.group(1)] = re.findall(r'^\s+`([^`]+)`', m.group(2), re.M)
    pos = 0
    for m in re.finditer(r'INSERT INTO `([^`]+)`(?: \(([^)]*)\))? VALUES', text):
        if m.start() < pos:
            continue
        table = m.group(1)
        cols = [c.strip(' `') for c in m.group(2).split(',')] if m.group(2) else cols_by_table.get(table, [])
        i, n = m.end(), len(text)
        while i < n:
            while i < n and text[i] in ' \t\r\n,':
                i += 1
            if i >= n or text[i] == ';':
                i += 1
                break
            if text[i] != '(':
                raise ValueError('unexpected character in %s' % table)
            i += 1
            row = []
            while True:
                while text[i] in ' \t\r\n':
                    i += 1
                if text.startswith('_binary', i):
                    i += 7
                    while text[i] in ' \t':
                        i += 1
                if text[i] == "'":
                    i += 1
                    buf = []
                    while True:
                        ch = text[i]
                        if ch == '\\':
                            nxt = text[i + 1]
                            buf.append({'n': '\n', 'r': '\r', 't': '\t', '0': '\0', 'b': '\b', 'Z': '\x1a'}.get(nxt, nxt))
                            i += 2
                        elif ch == "'":
                            if text[i + 1] == "'":
                                buf.append("'")
                                i += 2
                            else:
                                i += 1
                                break
                        else:
                            buf.append(ch)
                            i += 1
                    row.append(''.join(buf))
                else:
                    j = i
                    while text[j] not in ',)':
                        j += 1
                    token = text[i:j].strip()
                    row.append(None if token.upper() == 'NULL' else token)
                    i = j
                while text[i] in ' \t\r\n':
                    i += 1
                if text[i] == ',':
                    i += 1
                    continue
                if text[i] == ')':
                    i += 1
                    break
                raise ValueError('bad row in %s' % table)
            yield table, cols, tuple(row)
        pos = i

def load(paths):
    data = {}
    for p in paths:
        for table, cols, row in parse_dump(p):
            if len(cols) != len(row):
                raise ValueError('column/value count mismatch in %s' % table)
            data.setdefault(table, []).append(dict(zip(cols, row)))
    return data

def show(title, counter, limit=25):
    print('  %s' % title)
    for key, count in counter.most_common(limit):
        print('    %6d  %s' % (count, key if key not in (None, '') else '(blank)'))

def prefix(value, size=4):
    if not value:
        return '(blank)'
    m = re.match(r'^[A-Za-z]{1,4}[_-]', value)
    return m.group(0) if m else '(other)'

def main(paths):
    d = load(paths)
    today = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print('TABLE ROW COUNTS')
    for t in sorted(d):
        print('  %6d  %s' % (len(d[t]), t))
    users = d.get('psspaceusers', [])
    print('\nUSERS (psspaceusers): %d' % len(users))
    print('  flagged deleted=%d spam=%d user_status!=0: %d' % (
        sum(u['deleted'] != '0' for u in users), sum(u['spam'] != '0' for u in users), sum(u['user_status'] != '0' for u in users)))
    def hash_format(h):
        if not h: return '(blank)'
        if h.startswith('$P$'): return '$P$ phpass'
        if h.startswith('$wp$2y$'): return '$wp$2y$ wp-bcrypt'
        if h.startswith('$2y$') or h.startswith('$2b$') or h.startswith('$2a$'): return 'plain bcrypt'
        return '(other format)'
    show('password hash formats', Counter(hash_format(u['user_pass']) for u in users))
    emails = [(u['user_email'] or '').strip().lower() for u in users]
    dup = sum(c - 1 for c in Counter(e for e in emails if e).values() if c > 1)
    print('  emails: blank=%d no-@=%d duplicates(case-insensitive extra rows)=%d' % (
        sum(not e for e in emails), sum(bool(e) and '@' not in e for e in emails), dup))
    show('registered by year', Counter((u['user_registered'] or '')[:4] for u in users))
    meta = d.get('psspaceusermeta', [])
    stripe = [m['meta_value'] for m in meta if (m['meta_key'] or '').startswith('_mepr_stripe_customer_id_')]
    print('  stripe customer meta rows=%d distinct=%d' % (len(stripe), len(set(stripe))))
    show('stripe customer id prefixes', Counter(prefix(v) for v in stripe))
    mkeys = Counter(m['meta_key'] for m in meta if (m['meta_key'] or '').startswith('_mepr_stripe_customer_id_'))
    show('stripe customer meta keys (gateway/currency variants)', mkeys)
    uids = set(u['ID'] for u in users)
    tx = d.get('psspace58_mepr_transactions', [])
    print('\nTRANSACTIONS: %d (distinct users %d; users not in user file: %d)' % (
        len(tx), len(set(t['user_id'] for t in tx)), len(set(t['user_id'] for t in tx) - uids)))
    for col in ('status', 'txn_type', 'gateway', 'product_id'):
        show(col, Counter(t[col] for t in tx))
    show('trans_num prefix', Counter(prefix(t['trans_num']) for t in tx))
    show('amount zero or blank', Counter('zero' if (t['amount'] in (None, '', '0.00')) else 'nonzero' for t in tx))
    def expiry(t):
        e = t['expires_at']
        if not e or e.startswith('0000'): return 'no expiry (lifetime/blank)'
        return 'future' if e > today else 'past'
    show('expires_at', Counter(expiry(t) for t in tx))
    show('transactions linked to a subscription', Counter('yes' if t['subscription_id'] not in (None, '', '0') else 'no' for t in tx))
    subs = d.get('psspace58_mepr_subscriptions', [])
    print('\nSUBSCRIPTIONS: %d (distinct users %d)' % (len(subs), len(set(s['user_id'] for s in subs))))
    for col in ('status', 'gateway', 'product_id', 'period_type', 'period'):
        show(col, Counter(s[col] for s in subs))
    show('subscr_id prefix', Counter(prefix(s['subscr_id']) for s in subs))
    orders = d.get('psspace58_mepr_orders', [])
    print('\nORDERS: %d' % len(orders))
    for col in ('status', 'gateway'):
        show(col, Counter(o[col] for o in orders))
    show('order trans_num prefix', Counter(prefix(o['trans_num']) for o in orders))
    members = d.get('psspace58_mepr_members', [])
    print('\nMEMBERPRESS MEMBERS (summary rows): %d; with active subscription count>0: %d; active txn count>0: %d' % (
        len(members), sum((m['active_sub_count'] or '0') != '0' for m in members), sum((m['active_txn_count'] or '0') != '0' for m in members)))

if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit('Usage: python3 profile_legacy_dump.py FILE.sql [FILE2.sql ...]')
    main(sys.argv[1:])
