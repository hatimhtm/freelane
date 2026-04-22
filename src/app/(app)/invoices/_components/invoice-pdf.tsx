"use client";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  PDFDownloadLink,
  Font,
} from "@react-pdf/renderer";
import { Button } from "@/components/ui/button";
import type { LineItem } from "@/lib/supabase/types";

// Register a clean system-adjacent font for PDF rendering (react-pdf ships Helvetica by default).
Font.registerHyphenationCallback((word) => [word]);

export type PdfData = {
  issuer: {
    name: string;
    role: string;
    address: string;
    phone: string;
    email: string;
    cin: string;
  };
  client: {
    name: string;
    company: string | null;
    address: string | null;
    city: string | null;
    country: string | null;
    ice: string | null;
    rc: string | null;
  };
  invoice_number: string;
  issue_date: string;
  due_date: string | null;
  currency: string;
  language: string;
  line_items: LineItem[];
  subtotal: number;
  tva_rate: number;
  tva_amount: number;
  total: number;
  show_tva_note: boolean;
  tva_note: string;
  footer: string;
  accent_color: string;
};

type InvoiceLabels = {
  title: string;
  date: string;
  invoiceNumber: string;
  issuer: string;
  client: string;
  description: string;
  quantity: string;
  unit: string;
  amount: string;
  subtotal: string;
  tva: string;
  total: string;
};

const LABELS_FR: InvoiceLabels = {
  title: "FACTURE",
  date: "Date",
  invoiceNumber: "Facture N°",
  issuer: "ÉMETTEUR",
  client: "FACTURÉ À",
  description: "Description",
  quantity: "Quantité",
  unit: "Prix Unitaire",
  amount: "Montant",
  subtotal: "Sous-total",
  tva: "TVA",
  total: "Total Net à Payer",
};

const LABELS_EN: InvoiceLabels = {
  title: "INVOICE",
  date: "Date",
  invoiceNumber: "Invoice No.",
  issuer: "FROM",
  client: "BILL TO",
  description: "Description",
  quantity: "Qty",
  unit: "Unit price",
  amount: "Amount",
  subtotal: "Subtotal",
  tva: "VAT",
  total: "Total due",
};

const styles = StyleSheet.create({
  page: {
    paddingTop: 48,
    paddingBottom: 48,
    paddingHorizontal: 56,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#333",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-end",
    borderBottomWidth: 2,
    paddingBottom: 14,
    marginBottom: 28,
  },
  title: {
    fontSize: 28,
    letterSpacing: 2,
    fontFamily: "Helvetica-Bold",
  },
  meta: {
    textAlign: "right",
    fontSize: 10,
    color: "#555",
  },
  metaRow: { marginBottom: 2 },
  metaLabel: { fontFamily: "Helvetica-Bold" },
  addresses: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 32,
  },
  addressBlock: { width: "48%" },
  addressTitle: {
    fontSize: 9,
    color: "#888",
    letterSpacing: 1,
    marginBottom: 6,
    fontFamily: "Helvetica-Bold",
  },
  addressName: {
    fontSize: 13,
    marginBottom: 4,
    fontFamily: "Helvetica-Bold",
  },
  addressLine: { marginBottom: 2, fontSize: 10 },
  tableWrap: { marginBottom: 28 },
  tableHeader: {
    flexDirection: "row",
    backgroundColor: "#f9f9f9",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  tableHeaderCell: {
    fontSize: 9,
    fontFamily: "Helvetica-Bold",
    color: "#555",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  tableRow: {
    flexDirection: "row",
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#eee",
  },
  col_description: { flex: 1 },
  col_quantity: { width: 70, textAlign: "right" },
  col_unit: { width: 100, textAlign: "right" },
  col_amount: { width: 100, textAlign: "right" },
  totalSection: {
    flexDirection: "row",
    justifyContent: "flex-end",
  },
  totalBox: {
    width: 240,
    backgroundColor: "#f9f9f9",
    padding: 14,
    borderRadius: 4,
  },
  totalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  totalLabel: {
    fontSize: 13,
    fontFamily: "Helvetica-Bold",
  },
  totalValue: {
    fontSize: 15,
    fontFamily: "Helvetica-Bold",
  },
  subtotalRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 6,
    fontSize: 10,
    color: "#555",
  },
  tvaNote: {
    fontSize: 9,
    color: "#888",
    textAlign: "right",
    marginTop: 6,
    fontStyle: "italic",
  },
  footer: {
    marginTop: 60,
    paddingTop: 14,
    borderTopWidth: 1,
    borderTopColor: "#eee",
    textAlign: "center",
    fontSize: 10,
    color: "#777",
  },
});

function formatMoney(amount: number, currency: string) {
  const n = new Intl.NumberFormat("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${n} ${currency}`;
}

function formatDate(iso: string, lang: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(lang === "fr" ? "fr-FR" : "en-US", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export function InvoicePdf({ data }: { data: PdfData }) {
  const L = data.language === "en" ? LABELS_EN : LABELS_FR;
  const accent = data.accent_color || "#2c3e50";

  return (
    <Document title={`${L.title} ${data.invoice_number}`}>
      <Page size="A4" style={styles.page}>
        <View style={[styles.header, { borderBottomColor: accent }]}>
          <Text style={[styles.title, { color: accent }]}>{L.title}</Text>
          <View style={styles.meta}>
            <Text style={styles.metaRow}>
              <Text style={styles.metaLabel}>{L.date} : </Text>
              {formatDate(data.issue_date, data.language)}
            </Text>
            <Text style={styles.metaRow}>
              <Text style={styles.metaLabel}>{L.invoiceNumber} : </Text>
              {data.invoice_number}
            </Text>
          </View>
        </View>

        <View style={styles.addresses}>
          <View style={styles.addressBlock}>
            <Text style={styles.addressTitle}>{L.issuer}</Text>
            <Text style={[styles.addressName, { color: accent }]}>
              {data.issuer.name}
            </Text>
            {data.issuer.role ? <Text style={styles.addressLine}>{data.issuer.role}</Text> : null}
            {(data.issuer.address || "").split("\n").map((line, i) => (
              <Text key={i} style={styles.addressLine}>{line}</Text>
            ))}
            {data.issuer.phone ? (
              <Text style={[styles.addressLine, { marginTop: 6 }]}>
                <Text style={styles.metaLabel}>Tél : </Text>
                {data.issuer.phone}
              </Text>
            ) : null}
            {data.issuer.email ? (
              <Text style={styles.addressLine}>
                <Text style={styles.metaLabel}>Email : </Text>
                {data.issuer.email}
              </Text>
            ) : null}
            {data.issuer.cin ? (
              <Text style={styles.addressLine}>
                <Text style={styles.metaLabel}>CIN : </Text>
                {data.issuer.cin}
              </Text>
            ) : null}
          </View>

          <View style={[styles.addressBlock, { alignItems: "flex-end" }]}>
            <Text style={styles.addressTitle}>{L.client}</Text>
            <Text style={[styles.addressName, { color: accent }]}>
              {data.client.name}
            </Text>
            {data.client.company ? <Text style={styles.addressLine}>{data.client.company}</Text> : null}
            {data.client.address ? <Text style={styles.addressLine}>{data.client.address}</Text> : null}
            {(data.client.city || data.client.country) ? (
              <Text style={styles.addressLine}>
                {[data.client.city, data.client.country].filter(Boolean).join(", ").toUpperCase()}
              </Text>
            ) : null}
            {data.client.ice ? (
              <Text style={[styles.addressLine, { marginTop: 6 }]}>
                <Text style={styles.metaLabel}>ICE : </Text>
                {data.client.ice}
              </Text>
            ) : null}
            {data.client.rc ? (
              <Text style={styles.addressLine}>
                <Text style={styles.metaLabel}>RC : </Text>
                {data.client.rc}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.tableWrap}>
          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, styles.col_description]}>{L.description}</Text>
            <Text style={[styles.tableHeaderCell, styles.col_quantity]}>{L.quantity}</Text>
            <Text style={[styles.tableHeaderCell, styles.col_unit]}>{L.unit}</Text>
            <Text style={[styles.tableHeaderCell, styles.col_amount]}>{L.amount}</Text>
          </View>
          {data.line_items.map((li, i) => (
            <View key={i} style={styles.tableRow}>
              <Text style={styles.col_description}>{li.description}</Text>
              <Text style={styles.col_quantity}>{li.quantity}</Text>
              <Text style={styles.col_unit}>{formatMoney(Number(li.unit_price), data.currency)}</Text>
              <Text style={styles.col_amount}>{formatMoney(Number(li.amount), data.currency)}</Text>
            </View>
          ))}
        </View>

        <View style={styles.totalSection}>
          <View>
            <View style={styles.totalBox}>
              {data.tva_rate > 0 ? (
                <>
                  <View style={styles.subtotalRow}>
                    <Text>{L.subtotal}</Text>
                    <Text>{formatMoney(data.subtotal, data.currency)}</Text>
                  </View>
                  <View style={styles.subtotalRow}>
                    <Text>{L.tva} ({data.tva_rate}%)</Text>
                    <Text>{formatMoney(data.tva_amount, data.currency)}</Text>
                  </View>
                </>
              ) : null}
              <View style={styles.totalRow}>
                <Text style={[styles.totalLabel, { color: accent }]}>{L.total}</Text>
                <Text style={[styles.totalValue, { color: accent }]}>
                  {formatMoney(data.total, data.currency)}
                </Text>
              </View>
            </View>
            {data.show_tva_note && data.tva_note ? (
              <Text style={styles.tvaNote}>* {data.tva_note}</Text>
            ) : null}
          </View>
        </View>

        {data.footer ? <Text style={styles.footer}>{data.footer}</Text> : null}
      </Page>
    </Document>
  );
}

export function InvoicePdfDownload({
  data,
  fileName,
  children,
}: {
  data: PdfData;
  fileName: string;
  children: React.ReactNode;
}) {
  return (
    <PDFDownloadLink document={<InvoicePdf data={data} />} fileName={fileName}>
      {({ loading }) => (
        <Button variant="outline" disabled={loading}>
          {loading ? "Preparing…" : children}
        </Button>
      )}
    </PDFDownloadLink>
  );
}
