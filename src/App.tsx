import { AppShell } from './components/AppShell'

export default function App() {
  return (
    <AppShell title="BackpropPirates" subtitle="Life Powered by Tech 2026">
      <section className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
        <h2 className="text-base font-semibold">The app shell is live</h2>
        <p className="mt-1 text-sm text-slate-600">
          Our core feature goes here once we've locked the problem, the user and the dataset.
        </p>
      </section>
    </AppShell>
  )
}
