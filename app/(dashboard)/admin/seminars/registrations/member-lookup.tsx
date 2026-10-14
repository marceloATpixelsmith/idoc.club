'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { searchRegistrationMembersAction } from '../actions';

type Match = { email: string; firstName: string; lastName: string; profileId: number };

/** Searchable lookup that attaches a new registration to one active member: type a name or email,
 * pick the exact record from the dropdown, and only that member's profile id is submitted. */
export function MemberLookup() {
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [selected, setSelected] = useState<Match | null>(null);
  const [searched, setSearched] = useState(false);
  const requestId = useRef(0);

  useEffect(() => {
    if (selected || query.trim().length < 2) { setMatches([]); setSearched(false); return; }
    const current = ++requestId.current;
    const timer = setTimeout(async () => {
      const found = await searchRegistrationMembersAction(query);
      if (current === requestId.current) { setMatches(found); setSearched(true); }
    }, 250);
    return () => clearTimeout(timer);
  }, [query, selected]);

  return (
    <div className="space-y-1.5">
      <Label htmlFor="memberLookup">Member</Label>
      <input name="profileId" type="hidden" value={selected?.profileId ?? ''} />
      {selected ? (
        <div className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
          <span><strong>{selected.firstName} {selected.lastName}</strong> · {selected.email}</span>
          <button className="text-xs underline" onClick={() => { setSelected(null); setQuery(''); }} type="button">Change</button>
        </div>
      ) : (
        <div className="relative">
          <Input aria-autocomplete="list" aria-expanded={matches.length > 0} autoComplete="off" id="memberLookup" onChange={(event) => setQuery(event.target.value)} placeholder="Search active members by name or email…" role="combobox" value={query} />
          {matches.length > 0 ? (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-sm shadow-md" role="listbox">
              {matches.map((match) => (
                <li key={match.profileId} role="option" aria-selected="false">
                  <button className="w-full rounded px-2 py-1.5 text-left hover:bg-accent" onClick={() => { setSelected(match); setMatches([]); }} type="button">
                    <strong>{match.firstName} {match.lastName}</strong> <span className="text-muted-foreground">· {match.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : searched ? <p className="mt-1 text-xs text-muted-foreground">No active member matches that search.</p> : null}
        </div>
      )}
      <p className="text-xs text-muted-foreground">Required. Registrations can only be created for active members.</p>
    </div>
  );
}
