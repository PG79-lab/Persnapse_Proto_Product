import Link from "next/link";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center px-6 text-center">
      <section>
        <p className="text-sm text-[var(--accent)]">404</p>
        <h1 className="mt-2 text-2xl font-semibold">
          요청한 화면을 찾을 수 없습니다.
        </h1>
        <Link
          className="mt-6 inline-block text-sm font-semibold text-[var(--accent)]"
          href="/"
        >
          처음으로 돌아가기
        </Link>
      </section>
    </main>
  );
}
