'use client';

import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

export function ArticleThumbnailField({ id, initialImageUrl = null, label }: {
  id: string;
  initialImageUrl?: string | null;
  label: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const imageUrl = previewUrl ?? initialImageUrl;

  return (
    <div className="grid gap-4 sm:grid-cols-[7rem_1fr] sm:items-start">
      <div>
        <p className="mb-1.5 text-sm font-medium">{previewUrl ? 'Selected image' : 'Current image'}</p>
        {imageUrl ? (
          <img
            alt={previewUrl ? 'Selected article thumbnail preview' : 'Current article thumbnail'}
            className="aspect-[4/3] w-28 rounded-md border border-input object-cover"
            src={imageUrl}
          />
        ) : (
          <div className="flex aspect-[4/3] w-28 items-center justify-center rounded-md border border-dashed border-input text-center text-xs text-muted-foreground">
            No image selected
          </div>
        )}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={id}>{label}</Label>
        <Input
          accept="image/avif,image/jpeg,image/png,image/webp"
          id={id}
          name="thumbnail"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            setPreviewUrl(file ? URL.createObjectURL(file) : null);
          }}
          type="file"
        />
        <p className="text-sm text-muted-foreground">JPG, PNG, WEBP, or AVIF. Maximum 5 MB.</p>
      </div>
    </div>
  );
}
