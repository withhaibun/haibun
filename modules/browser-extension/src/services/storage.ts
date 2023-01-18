type TStorage = {
  [name: string]: any
}

export default {
  get(keys: any): Promise<TStorage> {
    if (!chrome.storage || !chrome.storage.local) {
      return Promise.reject('Browser storage not available')
    }

    return new Promise(resolve => chrome.storage.local.get(keys, props => resolve(props)))
  },

  set(props: any) {
    if (!chrome.storage || !chrome.storage.local) {
      return Promise.reject('Browser storage not available')
    }

    return new Promise(resolve => chrome.storage.local.set(props, () => resolve(true)))
  },

  remove(keys: any) {
    if (!chrome.storage || !chrome.storage.local) {
      return Promise.reject('Browser storage not available')
    }

    return new Promise(resolve => chrome.storage.local.remove(keys, () => resolve(true)))
  },
}
