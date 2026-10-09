'use client';

import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function BoardPhotoField({ initialImageUrl = null }: { initialImageUrl?: string | null }) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [removeCurrent, setRemoveCurrent] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const readerRef = useRef<FileReader | null>(null);
  const imageUrl = previewUrl ?? (removeCurrent ? null : initialImageUrl);

  function selectFile(file?: File) {
    readerRef.current?.abort();
    readerRef.current = null;
    setRemoveCurrent(false);
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    const reader = new FileReader();
    readerRef.current = reader;
    reader.onload = () => {
      if (readerRef.current === reader) {
        setPreviewUrl(typeof reader.result === 'string' ? reader.result : null);
        readerRef.current = null;
      }
    };
    reader.onerror = () => {
      if (readerRef.current === reader) {
        setPreviewUrl(null);
        readerRef.current = null;
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="grid gap-4 sm:grid-cols-[7rem_1fr] sm:items-start">
      <div>
        <p className="mb-1.5 text-sm font-medium">{previewUrl ? 'Selected image' : removeCurrent ? 'Image will be removed' : 'Current image'}</p>
        {imageUrl ? (
          <img alt={previewUrl ? 'Selected board photo preview' : 'Current board photo'} className="aspect-[4/5] w-28 rounded-md border border-input object-cover object-top" src={imageUrl} />
        ) : (
          <div className="flex aspect-[4/5] w-28 items-center justify-center rounded-md border border-dashed border-input text-center text-xs text-muted-foreground">
            {removeCurrent ? 'Image will be removed' : 'No image selected'}
          </div>
        )}
      </div>
      <div className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="boardPhoto">Board Photo</Label>
          <Input
            accept="image/avif,image/jpeg,image/png,image/webp"
            id="boardPhoto"
            name="boardPhoto"
            onChange={(event) => selectFile(event.currentTarget.files?.[0])}
            ref={fileInputRef}
            type="file"
          />
          <p className="text-sm text-muted-foreground">JPG, PNG, WEBP, or AVIF. Maximum 4 MB.</p>
        </div>
        {initialImageUrl ? (
          <label className="flex items-center gap-2 text-sm">
            <input
              checked={removeCurrent}
              name="removeBoardPhoto"
              onChange={(event) => {
                const checked = event.currentTarget.checked;
                setRemoveCurrent(checked);
                if (checked) {
                  readerRef.current?.abort();
                  readerRef.current = null;
                  setPreviewUrl(null);
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }
              }}
              type="checkbox"
              value="1"
            />
            Remove current image
          </label>
        ) : null}
      </div>
    </div>
  );
}
