package com.houseofbeauty;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class houseofbeautyApplication {

    public static void main(String[] args) {
        SpringApplication.run(houseofbeautyApplication.class, args);
    }

}

