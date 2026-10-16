"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { User, getUser, logout } from "../lib";

/** Signed in manager chip with a logout button. Shows Sign in when nobody is signed in. */
export default function UserMenu({ club = true }: { club?: boolean }) {
  const [u, setU] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => { setU(getUser()); setReady(true); }, []);
  if (!ready) return <div className="umenu" />;
  if (!u) return <Link href="/login" className="cta small">Sign in</Link>;
  return (
    <div className="umenu">
      {club && <Link href="/club" className="ghost small">My club</Link>}
      <span className="uchip" title={u.name}>
        <span className="uava" style={{ background: u.avatar }}>{u.name.slice(0, 1).toUpperCase()}</span>
        <span className="uname">{u.name}</span>
      </span>
      <button className="logout" onClick={logout} title="Log out">Log out</button>
    </div>
  );
}
