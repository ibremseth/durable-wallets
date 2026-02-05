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
  const [dataMode, setDataMode] = useState<"raw" | "abi">("raw");
  const [data, setData] = useState("");
  const [abi, setAbi] = useState("");
  const [args, setArgs] = useState("");
  const [txCount, setTxCount] = useState("1");
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
    const count = Math.max(1, parseInt(txCount) || 1);

    try {
      const body: Record<string, unknown> = { to };
      if (value) body.value = value;
      if (dataMode === "raw" && data) {
        body.data = data;
      } else if (dataMode === "abi" && abi) {
        body.abi = abi;
        body.args = args ? JSON.parse(args) : [];
      }

      // Use pool endpoint if no wallet specified, otherwise direct wallet endpoint
      const endpoint = walletAddress
        ? `/wallets/${walletAddress}/send`
        : "/pool/send";

      const promises = Array.from({ length: count }, () =>
        fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }).then((res) => res.json())
      );

      const results = await Promise.all(promises);
      setResponses((prev) => [...results.reverse(), ...prev]);
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

        <div style={styles.toggleRow}>
          <label style={styles.label}>Calldata</label>
          <div style={styles.toggle}>
            <button
              style={dataMode === "raw" ? styles.toggleActive : styles.toggleInactive}
              onClick={() => setDataMode("raw")}
              type="button"
            >
              Raw Hex
            </button>
            <button
              style={dataMode === "abi" ? styles.toggleActive : styles.toggleInactive}
              onClick={() => setDataMode("abi")}
              type="button"
            >
              ABI
            </button>
          </div>
        </div>

        {dataMode === "raw" ? (
          <input
            style={styles.input}
            value={data}
            onChange={(e) => setData(e.target.value)}
            placeholder="0x..."
          />
        ) : (
          <>
            <input
              style={styles.input}
              value={abi}
              onChange={(e) => setAbi(e.target.value)}
              placeholder="mint(address,uint256)"
            />
            <input
              style={styles.input}
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder='["0x123...", 100]'
            />
          </>
        )}

        <div style={styles.buttonRow}>
          <button
            style={styles.button}
            onClick={sendTx}
            disabled={loading || !to}
          >
            {loading ? "Sending..." : "Send Transaction"}
          </button>
          <input
            type="number"
            min="1"
            style={styles.countInput}
            value={txCount}
            onChange={(e) => setTxCount(e.target.value)}
            placeholder="1"
          />
        </div>
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
  buttonRow: {
    display: "flex",
    gap: 8,
  },
  button: {
    flex: 1,
    padding: "10px 16px",
    fontSize: 14,
    fontWeight: 500,
    color: "#fff",
    backgroundColor: "#0070f3",
    border: "none",
    borderRadius: 4,
    cursor: "pointer",
  },
  countInput: {
    width: 60,
    padding: "8px 12px",
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    textAlign: "center" as const,
  },
  toggleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 4,
  },
  toggle: {
    display: "flex",
    gap: 4,
  },
  toggleActive: {
    padding: "4px 8px",
    fontSize: 12,
    border: "none",
    borderRadius: 4,
    backgroundColor: "#0070f3",
    color: "#fff",
    cursor: "pointer",
  },
  toggleInactive: {
    padding: "4px 8px",
    fontSize: 12,
    border: "1px solid #ccc",
    borderRadius: 4,
    backgroundColor: "#fff",
    color: "#333",
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
