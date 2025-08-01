// XaresAICoder Service Worker
// Provides caching and offline functionality for PWA

const CACHE_NAME = 'xaresaicoder-v4_1_0';
const STATIC_CACHE_NAME = 'xaresaicoder-static-v4_1_0';
const DYNAMIC_CACHE_NAME = 'xaresaicoder-dynamic-v4_1_0';

// Assets to cache immediately (shell)
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/style.css',
  '/app.js',
  '/version.js',
  '/version.js',
  '/logo.png',
  '/favicon.ico',
  '/manifest.json',
  '/offline.html',
  // PWA Icons
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
  // Google Fonts
  'https://fonts.googleapis.com/css2?family=Segoe+UI:wght@400;500;600;700&display=swap'
];

// API endpoints that should use network-first strategy
const API_ENDPOINTS = [
  '/api/projects',
  '/api/health',
  '/api/workspace'
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
  console.log('[SW] Installing service worker...');
  
  event.waitUntil(
    caches.open(STATIC_CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Caching static assets');
        return cache.addAll(STATIC_ASSETS);
      })
      .then(() => {
        console.log('[SW] Static assets cached successfully');
        // Skip waiting to activate immediately
        return self.skipWaiting();
      })
      .catch((error) => {
        console.error('[SW] Failed to cache static assets:', error);
      })
  );
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating service worker...');
  
  event.waitUntil(
    caches.keys()
      .then((cacheNames) => {
        return Promise.all(
          cacheNames.map((cacheName) => {
            // Delete old caches
            if (cacheName !== STATIC_CACHE_NAME && cacheName !== DYNAMIC_CACHE_NAME) {
              console.log('[SW] Deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        console.log('[SW] Service worker activated');
        // Take control of all clients immediately
        return self.clients.claim();
      })
  );
});

// Fetch event - handle requests
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  
  // Skip non-HTTP requests
  if (!request.url.startsWith('http')) {
    return;
  }
  
  // Handle API requests with network-first strategy
  if (isApiRequest(request.url)) {
    event.respondWith(networkFirstStrategy(request));
    return;
  }
  
  // Handle static assets with cache-first strategy
  if (isStaticAsset(request.url)) {
    event.respondWith(cacheFirstStrategy(request));
    return;
  }
  
  // Handle navigation requests with network-first, fallback to offline page
  if (request.mode === 'navigate') {
    event.respondWith(navigationStrategy(request));
    return;
  }
  
  // Default: try network first, then cache
  event.respondWith(networkFirstStrategy(request));
});

// Check if request is for an API endpoint
function isApiRequest(url) {
  return API_ENDPOINTS.some(endpoint => url.includes(endpoint));
}

// Check if request is for a static asset
function isStaticAsset(url) {
  return STATIC_ASSETS.some(asset => {
    if (asset.startsWith('http')) {
      return url === asset;
    }
    return url.endsWith(asset) || url.includes(asset);
  });
}

// Cache-first strategy (good for static assets)
async function cacheFirstStrategy(request) {
  try {
    const cacheResponse = await caches.match(request);
    if (cacheResponse) {
      return cacheResponse;
    }
    
    const networkResponse = await fetch(request);
    
    // Cache successful responses
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', error);
    
    const cacheResponse = await caches.match(request);
    if (cacheResponse) {
      return cacheResponse;
    }
    
    throw error;
  }
}

// Network-first strategy (good for API calls and dynamic content)
async function networkFirstStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    
    // Cache successful responses for dynamic content
    if (networkResponse.ok && request.method === 'GET') {
      const cache = await caches.open(DYNAMIC_CACHE_NAME);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[SW] Network failed, trying cache:', error);
    
    const cacheResponse = await caches.match(request);
    if (cacheResponse) {
      return cacheResponse;
    }
    
    // Return offline page for navigation requests
    if (request.mode === 'navigate') {
      return caches.match('/offline.html');
    }
    
    throw error;
  }
}

// Navigation strategy (for page requests)
async function navigationStrategy(request) {
  try {
    const networkResponse = await fetch(request);
    return networkResponse;
  } catch (error) {
    console.log('[SW] Navigation failed, showing offline page');
    return caches.match('/offline.html');
  }
}

// Handle background sync (for future use)
self.addEventListener('sync', (event) => {
  console.log('[SW] Background sync:', event.tag);
  
  if (event.tag === 'background-sync') {
    event.waitUntil(doBackgroundSync());
  }
});

// Background sync handler
async function doBackgroundSync() {
  console.log('[SW] Performing background sync...');
  // Implement background sync logic here if needed
}

// Handle push notifications (for future use)
self.addEventListener('push', (event) => {
  console.log('[SW] Push received:', event);
  
  const options = {
    body: event.data ? event.data.text() : 'New notification from XaresAICoder',
    icon: '/icons/icon-192x192.png',
    badge: '/icons/icon-72x72.png',
    vibrate: [200, 100, 200],
    data: {
      dateOfArrival: Date.now(),
      primaryKey: 1
    },
    actions: [
      {
        action: 'explore',
        title: 'Open App',
        icon: '/icons/icon-192x192.png'
      },
      {
        action: 'close',
        title: 'Close',
        icon: '/icons/icon-192x192.png'
      }
    ]
  };
  
  event.waitUntil(
    self.registration.showNotification('XaresAICoder', options)
  );
});

// Handle notification clicks
self.addEventListener('notificationclick', (event) => {
  console.log('[SW] Notification clicked:', event);
  
  event.notification.close();
  
  if (event.action === 'explore') {
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Handle messages from main thread
self.addEventListener('message', (event) => {
  console.log('[SW] Message received:', event.data);
  
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  
  if (event.data && event.data.type === 'GET_VERSION') {
    event.ports[0].postMessage({
      version: CACHE_NAME
    });
  }
});

console.log('[SW] Service worker script loaded');