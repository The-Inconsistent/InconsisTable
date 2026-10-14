import "./lantern.css";

export default function Layout({ children }: { children: React.ReactNode }) {
  return <div className="proto-lantern">{children}</div>;
}
