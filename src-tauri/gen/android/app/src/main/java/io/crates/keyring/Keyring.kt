package io.crates.keyring

import android.content.Context

class Keyring {
  companion object {
    init {
      System.loadLibrary("k0nnect_lib")
    }

    external fun initializeNdkContext(context: Context)
  }
}
