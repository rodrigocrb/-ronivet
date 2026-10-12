package br.com.ronivet.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(RoniDriveAuthPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
