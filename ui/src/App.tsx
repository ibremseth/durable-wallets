import { useEffect, useState } from "react";

interface TxResponse {
  nonce?: number;
  status?: string;
  wallet?: string;
  error?: string;
}

export default function App() {
  const [wallets, setWallets] = useState<string[]>([]);
  const [walletAddress, setWalletAddress] = useState("");
  const [to, setTo] = useState("");
  const [value, setValue] = useState("");
  const [data, setData] = useState("");
  const [responses, setResponses] = useState<TxResponse[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/pool/wallets")
      .then((res) => res.json())
      .then((data) => setWallets(data.wallets || []))
      .catch(console.error);
  }, []);

  const sendTx = async () => {
    setLoading(true);
    try {
      const body: Record<string, string> = { to };
      if (value) body.value = value;
      if (data) body.data = data;

      // Use pool endpoint if no wallet specified, otherwise direct wallet endpoint
      const endpoint = walletAddress
        ? `/wallets/${walletAddress}/send`
        : "/pool/send";

      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setResponses((prev) => [json, ...prev]);
    } catch (err) {
      setResponses((prev) => [
        { error: err instanceof Error ? err.message : "Unknown error" },
        ...prev,
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.container}>
      <h1 style={styles.title}>Durable Wallets</h1>

      <div style={styles.section}>
        <h2 style={styles.subtitle}>Available Wallets</h2>
        {wallets.length === 0 ? (
          <p style={styles.empty}>Loading wallets...</p>
        ) : (
          <div style={styles.walletList}>
            {wallets.map((addr) => (
              <code key={addr} style={styles.walletAddr}>
                {addr}
              </code>
            ))}
          </div>
        )}
      </div>

      <div style={styles.section}>
        <label style={styles.label}>Wallet Address (optional)</label>
        <input
          style={styles.input}
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
          placeholder="Leave empty to auto-select from pool"
        />
      </div>

      <div style={styles.section}>
        <h2 style={styles.subtitle}>Send Transaction</h2>

        <label style={styles.label}>To Address *</label>
        <input
          style={styles.input}
          value={to}
          onChange={(e) => setTo(e.target.value)}
          placeholder="0x..."
        />

        <label style={styles.label}>Value (wei)</label>
        <input
          style={styles.input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
        />

        <label style={styles.label}>Data (hex)</label>
        <input
          style={styles.input}
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder="0x..."
        />

        <button
          style={styles.button}
          onClick={sendTx}
          disabled={loading || !to}
        >
          {loading ? "Sending..." : "Send Transaction"}
        </button>
      </div>

      <div style={styles.section}>
        <h2 style={styles.subtitle}>Responses</h2>
        {responses.length === 0 ? (
          <p style={styles.empty}>No transactions sent yet</p>
        ) : (
          responses.map((res, i) => (
            <pre key={i} style={styles.response}>
              {JSON.stringify(res, null, 2)}
            </pre>
          ))
        )}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 500,
    margin: "0 auto",
    padding: 20,
    fontFamily: "system-ui, sans-serif",
  },
  title: {
    marginBottom: 24,
  },
  subtitle: {
    fontSize: 18,
    marginBottom: 12,
  },
  section: {
    marginBottom: 24,
  },
  label: {
    display: "block",
    marginBottom: 4,
    fontSize: 14,
    fontWeight: 500,
  },
  input: {
    width: "100%",
    padding: "8px 12px",
    marginBottom: 12,
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    boxSizing: "border-box",
  },
  button: {
    width: "100%",
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 500,
    color: "#fff",
    backgroundColor: "#0070f3",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
  },
  response: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#f5f5f5",
    borderRadius: 4,
    fontSize: 12,
    overflow: "auto",
  },
  empty: {
    color: "#666",
    fontSize: 14,
  },
  walletList: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
  },
  walletAddr: {
    padding: "8px 12px",
    backgroundColor: "#f0f0f0",
    borderRadius: 4,
    fontSize: 12,
    wordBreak: "break-all",
  },
};
