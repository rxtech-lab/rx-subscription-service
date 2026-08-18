export default function TestSessionExpiredPage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 text-center">
      <h1 className="text-base font-semibold text-slate-950">Test session ended</h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        This test session has expired, or the test user was deleted. Reopen it from
        the console: Test tab → the user&rsquo;s menu → Test user.
      </p>
    </div>
  );
}
