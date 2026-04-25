import { useMemo, useRef, useState } from 'react';
import type { ChangeEvent, DragEvent } from 'react';
import {
  FileText,
  FileSearch,
  Globe,
  Type,
  Upload,
  Trash2,
  Eye,
  Sparkles,
  RotateCcw,
} from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  IconButton,
  Input,
  SegmentedControl,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
  Toggle,
  useToast,
} from '../../components/ui';
import { seedDemoKnowledgeBase } from '../../fixtures/demoKnowledge';
import { parseDocx, parsePdf, parsePlainText, parseUrl } from '../../lib/rag/documentParser';
import { logger } from '../../lib/logger';
import { createKnowledgeRepository } from '../../lib/rag/knowledgeRepository';
import './knowledge.css';

type SortMode = 'recent' | 'alpha' | 'size';
type SourceTab = 'upload' | 'url' | 'paste';
type CollectionTab = 'all' | 'company' | 'role' | 'personal';

type DocumentView = {
  id: string;
  name: string;
  kind: string;
  chunkCount: number;
  enabled: boolean;
  addedAt: number;
};

function resolveIcon(kind: string) {
  const lower = kind.toLowerCase();
  if (lower === 'url') return { icon: <Globe size={18} aria-hidden />, kindSlot: 'url' };
  if (lower === 'pasted' || lower === 'text' || lower.includes('text'))
    return { icon: <Type size={18} aria-hidden />, kindSlot: 'text' };
  return { icon: <FileText size={18} aria-hidden />, kindSlot: 'doc' };
}

function approxKb(chunkCount: number) {
  return Math.max(1, Math.round((chunkCount * 320) / 1024));
}

function collectionOf(doc: DocumentView, tab: CollectionTab): boolean {
  if (tab === 'all') return true;
  const name = doc.name.toLowerCase();
  if (tab === 'company')
    return name.includes('company') || name.includes('handbook') || name.includes('policy');
  if (tab === 'role')
    return (
      name.includes('role') ||
      name.includes('jd') ||
      name.includes('job') ||
      name.includes('requirement')
    );
  if (tab === 'personal')
    return name.includes('personal') || name.includes('resume') || name.includes('cv');
  return true;
}

export function KnowledgeBasePage() {
  const toast = useToast();
  const repository = useMemo(() => createKnowledgeRepository(), []);
  const [, setVersion] = useState(0);
  const [sourceTab, setSourceTab] = useState<SourceTab>('upload');
  const [collectionTab, setCollectionTab] = useState<CollectionTab>('all');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [loadingUrl, setLoadingUrl] = useState(false);
  const [pasteInput, setPasteInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortMode>('recent');
  const [previewDoc, setPreviewDoc] = useState<DocumentView | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<DocumentView | null>(null);
  const [resetDemoOpen, setResetDemoOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const documents = repository.listDocuments() as DocumentView[];
  const refresh = () => setVersion((v) => v + 1);

  const filteredDocs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = documents.filter((doc) => {
      const matchesSearch = !q || doc.name.toLowerCase().includes(q);
      const matchesCollection = collectionOf(doc, collectionTab);
      return matchesSearch && matchesCollection;
    });
    if (sort === 'alpha') list.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'size') list.sort((a, b) => b.chunkCount - a.chunkCount);
    else list.sort((a, b) => b.addedAt - a.addedAt);
    return list;
  }, [documents, search, sort, collectionTab]);

  async function ingestFile(file: File) {
    setUploading(true);
    try {
      let content = '';
      const lowerName = file.name.toLowerCase();

      if (lowerName.endsWith('.pdf')) {
        const buf = await file.arrayBuffer();
        content = await parsePdf(buf);
      } else if (lowerName.endsWith('.docx')) {
        const buf = await file.arrayBuffer();
        content = await parseDocx(buf);
      } else {
        content = parsePlainText(await file.text());
      }

      if (!content.trim()) {
        content = `Placeholder content for ${file.name}. Replace with extracted text for richer retrieval.`;
      }

      repository.saveDocument({
        id: `doc-${Date.now()}`,
        name: file.name,
        kind: lowerName.endsWith('.pdf')
          ? 'pdf'
          : lowerName.endsWith('.docx')
            ? 'docx'
            : file.type || 'text',
        content,
      });
      refresh();
      toast.show({
        title: 'Document added',
        description: `${file.name} was chunked and indexed.`,
        variant: 'success',
      });
    } catch (e) {
      toast.show({
        title: 'Upload failed',
        description: e instanceof Error ? e.message : 'Unknown error',
        variant: 'danger',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    await ingestFile(file);
  }

  async function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragOver(false);
    const file = event.dataTransfer.files?.[0];
    if (file) {
      await ingestFile(file);
    }
  }

  async function handleLoadUrl() {
    const value = urlInput.trim();
    if (!value) return;
    setLoadingUrl(true);
    try {
      const content = await parseUrl(value);
      repository.saveDocument({
        id: `url-${Date.now()}`,
        name: value,
        kind: 'url',
        content,
      });
      setUrlInput('');
      refresh();
      toast.show({
        title: 'URL indexed',
        description: `Fetched and chunked ${value}`,
        variant: 'success',
      });
    } catch (e) {
      toast.show({
        title: 'URL load failed',
        description: e instanceof Error ? e.message : 'Network error',
        variant: 'danger',
      });
    } finally {
      setLoadingUrl(false);
    }
  }

  function handlePaste() {
    const value = pasteInput.trim();
    if (!value) return;
    repository.saveDocument({
      id: `paste-${Date.now()}`,
      name: `Pasted snippet · ${new Date().toLocaleString()}`,
      kind: 'text',
      content: parsePlainText(value),
    });
    setPasteInput('');
    refresh();
    toast.show({
      title: 'Snippet added',
      description: 'Indexed as a pasted text document.',
      variant: 'success',
    });
  }

  function handleSeedDemo() {
    seedDemoKnowledgeBase();
    refresh();
    toast.show({
      title: 'Demo knowledge seeded',
      description: 'Pricing, security, and objection playbooks added.',
      variant: 'info',
    });
  }

  function handleResetToDemo() {
    // Manually clear via repository API (no clearAll() exists on the interface)
    const existing = repository.listDocuments();
    existing.forEach((doc) => repository.deleteDocument(doc.id));
    seedDemoKnowledgeBase();
    setResetDemoOpen(false);
    refresh();
    toast.show({
      title: 'Knowledge base reset',
      description: 'All documents cleared and demo playbooks reloaded.',
      variant: 'success',
    });
  }

  function handleToggle(id: string) {
    repository.toggleDocument(id);
    refresh();
  }

  function handleDelete(doc: DocumentView) {
    repository.deleteDocument(doc.id);
    setConfirmDelete(null);
    refresh();
    toast.show({
      title: 'Document removed',
      description: `${doc.name} was removed from the knowledge base.`,
      variant: 'info',
    });
  }

  const previewText = previewDoc
    ? repository.getChunks(previewDoc.id).join('\n\n').slice(0, 500)
    : '';

  return (
    <div className="kb-root">
      <header className="kb-head">
        <span className="kb-head__eyebrow">Retrieval</span>
        <h2 className="kb-head__title">Playbooks &amp; knowledge base</h2>
        <p className="kb-head__sub">
          Upload PDFs, DOCX, and text files, fetch URLs, or paste snippets. Enabled playbooks are
          consulted automatically during every live session.
        </p>
      </header>

      <div className="kb-layout">
        {/* ── Left column: source controls ─────────────────────────── */}
        <Card className="kb-col" padding="md">
          <Tabs value={sourceTab} onValueChange={(v) => setSourceTab(v as SourceTab)}>
            <TabsList aria-label="Source type">
              <TabsTrigger value="upload">Upload file</TabsTrigger>
              <TabsTrigger value="url">Add URL</TabsTrigger>
              <TabsTrigger value="paste">Paste text</TabsTrigger>
            </TabsList>

            <TabsContent value="upload">
              <div
                className="kb-drop-zone"
                data-dragover={dragOver ? 'true' : undefined}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => void handleDrop(e)}
                role="button"
                tabIndex={0}
                aria-label="Drop files here or click to browse"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    fileInputRef.current?.click();
                  }
                }}
              >
                <div className="kb-drop-zone__icon">
                  <Upload size={20} aria-hidden />
                </div>
                <div className="kb-drop-zone__title">
                  {uploading ? 'Uploading…' : 'Drop a file or click to browse'}
                </div>
                <div className="kb-drop-zone__hint">PDF · DOCX · TXT · MD</div>
                <input
                  ref={fileInputRef}
                  accept=".pdf,.docx,.txt,.md"
                  className="kb-hidden-input"
                  disabled={uploading}
                  onChange={(e) => void handleUpload(e)}
                  type="file"
                />
              </div>
              {uploading && (
                <div className="kb-upload-progress">
                  <Skeleton variant="box" height={8} rounded style={{ width: '100%' }} />
                  <Skeleton variant="text" width="40%" />
                </div>
              )}
            </TabsContent>

            <TabsContent value="url">
              <Input
                label="Source URL"
                placeholder="https://example.com/handbook"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleLoadUrl().catch((err) => {
                      logger.warn('knowledge-base', 'handleLoadUrl (key) failed', {
                        err: String(err),
                      });
                    });
                  }
                }}
                disabled={loadingUrl}
                leadingIcon={<Globe size={14} aria-hidden />}
              />
              {loadingUrl && (
                <div className="kb-upload-progress">
                  <Skeleton variant="box" height={8} rounded style={{ width: '100%' }} />
                  <Skeleton variant="text" width="55%" />
                </div>
              )}
              <Button
                variant="primary"
                disabled={!urlInput.trim() || loadingUrl}
                loading={loadingUrl}
                onClick={() => {
                  handleLoadUrl().catch((err) => {
                    logger.warn('knowledge-base', 'handleLoadUrl (click) failed', {
                      err: String(err),
                    });
                  });
                }}
              >
                Fetch and index
              </Button>
            </TabsContent>

            <TabsContent value="paste">
              <Textarea
                label="Paste any text"
                placeholder="Notes, transcripts, FAQs…"
                rows={8}
                autoResize
                value={pasteInput}
                onChange={(e) => setPasteInput(e.target.value)}
              />
              <Button variant="primary" onClick={handlePaste} disabled={!pasteInput.trim()}>
                Add to knowledge
              </Button>
            </TabsContent>
          </Tabs>

          <div className="kb-source-actions">
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<Sparkles size={14} aria-hidden />}
              onClick={handleSeedDemo}
            >
              Seed demo knowledge
            </Button>
            <Button
              variant="ghost"
              size="sm"
              leadingIcon={<RotateCcw size={14} aria-hidden />}
              onClick={() => setResetDemoOpen(true)}
            >
              Reset to demo data
            </Button>
          </div>
        </Card>

        {/* ── Right column: document library ─────────────────────── */}
        <div className="kb-col">
          {/* Collection tabs */}
          <Card padding="sm">
            <Tabs value={collectionTab} onValueChange={(v) => setCollectionTab(v as CollectionTab)}>
              <TabsList aria-label="Collection filter">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="company">Company</TabsTrigger>
                <TabsTrigger value="role">Role</TabsTrigger>
                <TabsTrigger value="personal">Personal</TabsTrigger>
              </TabsList>
            </Tabs>
          </Card>

          <Card padding="md">
            <div className="kb-library-toolbar">
              <Input
                className="kb-library-toolbar__search"
                placeholder="Search by title"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                leadingIcon={<FileSearch size={14} aria-hidden />}
              />
              <SegmentedControl<SortMode>
                value={sort}
                onChange={setSort}
                aria-label="Sort order"
                options={[
                  { value: 'recent', label: 'Recent' },
                  { value: 'alpha', label: 'A→Z' },
                  { value: 'size', label: 'Size' },
                ]}
              />
            </div>
          </Card>

          {filteredDocs.length === 0 ? (
            <Card padding="lg">
              <EmptyState
                icon={<FileSearch size={28} aria-hidden />}
                title={search ? 'No matches' : 'No playbooks yet'}
                description={
                  search
                    ? 'Try a different search query or clear the filter.'
                    : 'Upload a file, fetch a URL, or paste text to start building retrieval.'
                }
              />
            </Card>
          ) : (
            <>
              <div className="kb-library-count">
                {filteredDocs.length} playbook{filteredDocs.length === 1 ? '' : 's'}
              </div>
              <div className="kb-doc-list">
                {filteredDocs.map((doc) => {
                  const { icon, kindSlot } = resolveIcon(doc.kind);
                  return (
                    <div
                      className="kb-doc-row"
                      key={doc.id}
                      data-disabled={!doc.enabled || undefined}
                    >
                      <div className="kb-doc-icon" data-kind={kindSlot}>
                        {icon}
                      </div>
                      <div className="kb-doc-meta">
                        <span className="kb-doc-title">{doc.name}</span>
                        <span className="kb-doc-sub">
                          <Badge variant="neutral" size="sm">
                            {doc.kind}
                          </Badge>{' '}
                          {doc.chunkCount} chunk{doc.chunkCount === 1 ? '' : 's'} · ~
                          {approxKb(doc.chunkCount)} KB
                        </span>
                      </div>
                      <div className="kb-doc-actions">
                        <Toggle
                          checked={doc.enabled}
                          onChange={() => handleToggle(doc.id)}
                          size="sm"
                          aria-label={`Include ${doc.name} in prompts`}
                        />
                        <IconButton
                          aria-label={`Preview ${doc.name}`}
                          variant="ghost"
                          size="sm"
                          onClick={() => setPreviewDoc(doc)}
                        >
                          <Eye size={14} aria-hidden />
                        </IconButton>
                        <IconButton
                          aria-label={`Delete ${doc.name}`}
                          variant="danger"
                          size="sm"
                          onClick={() => setConfirmDelete(doc)}
                        >
                          <Trash2 size={14} aria-hidden />
                        </IconButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Preview dialog ──────────────────────────────────────── */}
      <Dialog
        open={previewDoc !== null}
        onClose={() => setPreviewDoc(null)}
        title={previewDoc?.name ?? 'Preview'}
        description={
          previewDoc ? (
            <>
              <Badge variant="gold" size="sm">
                {previewDoc.kind}
              </Badge>{' '}
              · {previewDoc.chunkCount} chunks · first 500 chars
            </>
          ) : null
        }
      >
        <div className="kb-preview-dialog__content">
          {previewText || 'This document has no indexed content yet.'}
        </div>
      </Dialog>

      {/* ── Delete confirm dialog ──────────────────────────────── */}
      <Dialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        title="Remove document?"
        description={
          confirmDelete
            ? `${confirmDelete.name} will be removed from the knowledge base.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => confirmDelete && handleDelete(confirmDelete)}>
              Remove
            </Button>
          </>
        }
      />

      {/* ── Reset to demo confirm dialog ───────────────────────── */}
      <Dialog
        open={resetDemoOpen}
        onClose={() => setResetDemoOpen(false)}
        title="Reset knowledge base to demo data?"
        description="Every uploaded, fetched, or pasted playbook will be permanently removed from this device. The demo pricing, security, and objection-handling snippets will be reloaded in their place. This cannot be undone."
        footer={
          <>
            <Button variant="ghost" onClick={() => setResetDemoOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              leadingIcon={<RotateCcw size={14} aria-hidden />}
              onClick={handleResetToDemo}
            >
              Wipe and reseed
            </Button>
          </>
        }
      />
    </div>
  );
}
