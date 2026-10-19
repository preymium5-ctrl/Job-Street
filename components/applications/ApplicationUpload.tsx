"use client";

import { useRef, useState } from "react";
import { FileText, Upload, X } from "lucide-react";
import styles from "./ApplicationUpload.module.css";

export interface ApplicationUploadProps {
  id: string;
  label: string;
  description: string;
  required: boolean;
  accept: string;
  file: File | null;
  disabled: boolean;
  error?: string;
  onChange: (file: File | undefined) => void;
  onRemove: () => void;
}

export function ApplicationUpload({ id, label, description, required, accept, file, disabled, error, onChange, onRemove }: ApplicationUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const supportsImages = /(?:jpe?g|png)/i.test(accept);
  const limits = supportsImages
    ? "PDF, DOC, DOCX, JPG, JPEG, PNG · Maximum 3 MB per file"
    : "PDF, DOC, DOCX · Maximum 3 MB per file";
  const describedBy = [`${id}-description`, `${id}-help`, `${id}-limits`, error ? `${id}-error` : undefined].filter(Boolean).join(" ");

  return (
    <div className={`${styles.card} ${disabled ? styles.disabled : ""}`}>
      <label className={styles.label} htmlFor={id}>{label}<span>{required ? "Required" : "Optional"}</span></label>
      <p className={styles.description} id={`${id}-description`}>{description}</p>
      <div className={`${styles.dropzone} ${dragging ? styles.dragging : ""} ${error ? styles.invalid : ""}`}
        onDragOver={(event) => { event.preventDefault(); if (!disabled) event.dataTransfer.dropEffect = "copy"; }}
        onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault(); setDragging(false);
          const nextFile = event.dataTransfer.files[0];
          if (!disabled && nextFile) onChange(nextFile);
        }}>
        <Upload size={25} aria-hidden="true" />
        <span className={styles.choose}>Choose a file</span>
        <p className={styles.help} id={`${id}-help`}>Tap to browse or drag and drop one file here</p>
        <input ref={inputRef} id={id} name={id} type="file" accept={accept} required={required} disabled={disabled}
          aria-required={required} aria-invalid={Boolean(error)} aria-describedby={describedBy}
          onChange={(event) => onChange(event.target.files?.[0])} />
      </div>
      <p className={styles.limits} id={`${id}-limits`}>{limits}</p>
      {file ? (
        <div className={styles.file}>
          <FileText size={20} aria-hidden="true" />
          <div><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB</span></div>
          <button type="button" disabled={disabled} aria-label={`Remove ${label}`} onClick={() => {
            if (inputRef.current) inputRef.current.value = "";
            onRemove();
          }}><X size={18} aria-hidden="true" /></button>
        </div>
      ) : <p className={styles.empty}>No file selected.</p>}
      {error && <p className={styles.error} id={`${id}-error`}>{error}</p>}
    </div>
  );
}
