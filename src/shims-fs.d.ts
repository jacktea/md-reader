// File System Access API types missing from TS 4.8 DOM lib
// Chrome 86+ supports these; esbuild compiles them regardless.

interface FileSystemHandle {
  readonly kind: 'file' | 'directory'
  readonly name: string
  queryPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>
  requestPermission(
    descriptor?: FileSystemHandlePermissionDescriptor,
  ): Promise<PermissionState>
}

interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemFileHandle extends FileSystemHandle {
  readonly kind: 'file'
  getFile(): Promise<File>
}

interface FileSystemDirectoryHandle extends FileSystemHandle {
  readonly kind: 'directory'
  values(): AsyncIterableIterator<FileSystemHandle>
  entries(): AsyncIterableIterator<[string, FileSystemHandle]>
  keys(): AsyncIterableIterator<string>
  getDirectoryHandle(
    name: string,
    options?: FileSystemGetDirectoryOptions,
  ): Promise<FileSystemDirectoryHandle>
  getFileHandle(
    name: string,
    options?: FileSystemGetFileOptions,
  ): Promise<FileSystemFileHandle>
  removeEntry(name: string, options?: FileSystemRemoveOptions): Promise<void>
  resolve(possibleDescendant: FileSystemHandle): Promise<string[] | null>
}

interface FileSystemGetDirectoryOptions {
  create?: boolean
}

interface FileSystemGetFileOptions {
  create?: boolean
}

interface FileSystemRemoveOptions {
  recursive?: boolean
}

interface Window {
  showDirectoryPicker(
    options?: FileSystemPickerOptions,
  ): Promise<FileSystemDirectoryHandle>
  showOpenFilePicker(
    options?: FileSystemPickerOptions,
  ): Promise<FileSystemFileHandle[]>
}

interface FileSystemPickerOptions {
  mode?: 'read' | 'readwrite'
  startIn?: FileSystemHandle | string
  id?: string
}
