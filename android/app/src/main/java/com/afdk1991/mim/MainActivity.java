package com.afdk1991.mim;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MimOtaPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
