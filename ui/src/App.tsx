import { useEffect, useState } from "react";

interface TxResponse {
  nonce?: number;
  status?: string;
  wallet?: string;
  error?: string;
}

interface WalletStatus {
  wallet: string;
  pendingNonce: number;
  submittedNonce: number;
  confirmedNonce: number;
  queueDepth: number;
  inFlight: number;
}

interface TxDetails {
  wallet: string;
  nonce: number;
  params: { to: string; value?: string; data?: string };
  hash?: string;
  createdAt: number;
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
  const [transactions, setTransactions] = useState<TxResponse[]>([]);
  const [selectedTx, setSelectedTx] = useState<TxDetails | null>(null);
  const [selectedWalletStatus, setSelectedWalletStatus] = useState<WalletStatus | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/pool/wallets")
      .then((res) => res.json())
      .then((data) => setWallets(data.wallets || []))
      .catch(console.error);
  }, []);

  const fetchWalletStatus = async (wallet: string) => {
    try {
      const res = await fetch(`/wallets/${wallet}/status`);
      if (res.ok) {
        const data = await res.json();
        setSelectedWalletStatus(data);
      } else {
        setSelectedWalletStatus({ wallet, pendingNonce: 0, submittedNonce: 0, confirmedNonce: 0, queueDepth: 0, inFlight: 0 });
      }
    } catch (err) {
      console.error(err);
    }
  };

  const fetchTxDetails = async (wallet: string, nonce: number) => {
    try {
      const res = await fetch(`/wallets/${wallet}/tx/${nonce}`);
      if (res.ok) {
        const data = await res.json();
        setSelectedTx(data);
      }
    } catch (err) {
      console.error(err);
    }
  };

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
      setTransactions((prev) => [...results.reverse(), ...prev]);
    } catch (err) {
      setTransactions((prev) => [
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
              <code
                key={addr}
                style={styles.walletAddr}
                onClick={() => fetchWalletStatus(addr)}
              >
                {addr}
              </code>
            ))}
          </div>
        )}
      </div>

      <div style={styles.section}>
        <label style={styles.label}>Select Wallet (optional)</label>
        <select
          style={styles.select}
          value={walletAddress}
          onChange={(e) => setWalletAddress(e.target.value)}
        >
          <option value="">Auto-select from pool</option>
          {wallets.map((addr) => (
            <option key={addr} value={addr}>
              {addr.slice(0, 10)}...{addr.slice(-8)}
            </option>
          ))}
        </select>
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
        <h2 style={styles.subtitle}>Transactions</h2>
        {transactions.length === 0 ? (
          <p style={styles.empty}>No transactions sent yet</p>
        ) : (
          transactions.map((tx, i) => (
            <div
              key={i}
              style={styles.txItem}
              onClick={() => tx.wallet && tx.nonce !== undefined && fetchTxDetails(tx.wallet, tx.nonce)}
            >
              <div style={styles.txHeader}>
                <span style={styles.txNonce}>Nonce: {tx.nonce ?? "?"}</span>
                <span style={styles.txStatus}>{tx.error ? "error" : tx.status}</span>
              </div>
              <code style={styles.txWallet}>{tx.wallet}</code>
            </div>
          ))
        )}
      </div>

      {selectedTx && (
        <div style={styles.modal} onClick={() => setSelectedTx(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Transaction Details</h3>
            <pre style={styles.modalPre}>{JSON.stringify(selectedTx, null, 2)}</pre>
            <button style={styles.button} onClick={() => setSelectedTx(null)}>
              Close
            </button>
          </div>
        </div>
      )}

      {selectedWalletStatus && (
        <div style={styles.modal} onClick={() => setSelectedWalletStatus(null)}>
          <div style={styles.modalContent} onClick={(e) => e.stopPropagation()}>
            <h3 style={styles.modalTitle}>Wallet Status</h3>
            <code style={styles.modalWallet}>{selectedWalletStatus.wallet}</code>
            <div style={styles.statusCard}>
              <div style={styles.statusRow}>
                <span>Queue Depth:</span>
                <strong>{selectedWalletStatus.queueDepth}</strong>
              </div>
              <div style={styles.statusRow}>
                <span>In Flight:</span>
                <strong>{selectedWalletStatus.inFlight}</strong>
              </div>
              <div style={styles.statusRow}>
                <span>Pending Nonce:</span>
                <strong>{selectedWalletStatus.pendingNonce}</strong>
              </div>
              <div style={styles.statusRow}>
                <span>Submitted Nonce:</span>
                <strong>{selectedWalletStatus.submittedNonce}</strong>
              </div>
              <div style={styles.statusRow}>
                <span>Confirmed Nonce:</span>
                <strong>{selectedWalletStatus.confirmedNonce}</strong>
              </div>
            </div>
            <button style={{ ...styles.button, marginTop: 12 }} onClick={() => setSelectedWalletStatus(null)}>
              Close
            </button>
          </div>
        </div>
      )}
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
  select: {
    width: "100%",
    padding: "8px 12px",
    marginBottom: 12,
    fontSize: 14,
    border: "1px solid #ccc",
    borderRadius: 4,
    boxSizing: "border-box" as const,
    backgroundColor: "#fff",
  },
  statusCard: {
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 4,
    fontSize: 13,
  },
  statusRow: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  txItem: {
    padding: 12,
    marginBottom: 8,
    backgroundColor: "#f5f5f5",
    borderRadius: 4,
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
  txHeader: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: 4,
  },
  txNonce: {
    fontWeight: 500,
    fontSize: 14,
  },
  txStatus: {
    fontSize: 12,
    color: "#666",
  },
  txWallet: {
    fontSize: 11,
    color: "#888",
  },
  modal: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1000,
  },
  modalContent: {
    backgroundColor: "#fff",
    padding: 20,
    borderRadius: 8,
    maxWidth: 500,
    width: "90%",
    maxHeight: "80vh",
    overflow: "auto",
  },
  modalTitle: {
    marginTop: 0,
    marginBottom: 12,
  },
  modalPre: {
    padding: 12,
    backgroundColor: "#f5f5f5",
    borderRadius: 4,
    fontSize: 12,
    overflow: "auto",
    marginBottom: 12,
  },
  modalWallet: {
    display: "block",
    padding: "8px 12px",
    backgroundColor: "#f0f0f0",
    borderRadius: 4,
    fontSize: 12,
    wordBreak: "break-all" as const,
    marginBottom: 12,
  },
  walletList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 8,
  },
  walletAddr: {
    padding: "8px 12px",
    backgroundColor: "#f0f0f0",
    borderRadius: 4,
    fontSize: 12,
    wordBreak: "break-all" as const,
    cursor: "pointer",
    transition: "background-color 0.15s",
  },
};
