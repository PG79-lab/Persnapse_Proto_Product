const DATABASE_NAME = "persnapse-local-recordings";
const DATABASE_VERSION = 1;
let databasePromise;

function openDatabase() {
  if (!globalThis.indexedDB)
    return Promise.reject(
      new Error("이 브라우저는 녹음 보관을 지원하지 않습니다."),
    );
  if (!databasePromise) {
    databasePromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("audio"))
          database.createObjectStore("audio");
        if (!database.objectStoreNames.contains("details"))
          database.createObjectStore("details", { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () =>
        reject(new Error("다른 탭에서 녹음 저장소를 사용 중입니다."));
    }).catch((error) => {
      databasePromise = undefined;
      throw error;
    });
  }
  return databasePromise;
}

function detailsOf(clip) {
  const details = { ...clip };
  delete details.blob;
  delete details.url;
  delete details.localSaved;
  return details;
}

export async function loadLocalRecordings() {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["audio", "details"], "readonly");
    const audio = transaction.objectStore("audio").getAll();
    const keys = transaction.objectStore("audio").getAllKeys();
    const details = transaction.objectStore("details").getAll();
    transaction.oncomplete = () => {
      const audioById = new Map(
        keys.result.map((id, index) => [id, audio.result[index]]),
      );
      resolve(
        details.result
          .filter((item) => audioById.has(item.id))
          .map((item) => ({ ...item, blob: audioById.get(item.id) }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      );
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function saveLocalRecording(clip) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["audio", "details"], "readwrite");
    transaction.objectStore("audio").put(clip.blob, clip.id);
    transaction.objectStore("details").put(detailsOf(clip));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function updateLocalRecording(clip) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction("details", "readwrite");
    transaction.objectStore("details").put(detailsOf(clip));
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export async function deleteLocalRecording(id) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(["audio", "details"], "readwrite");
    transaction.objectStore("audio").delete(id);
    transaction.objectStore("details").delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
