/*
 * Copyright 2025 Bronya0 <tangssst@163.com>.
 * Author Github: https://github.com/Bronya0
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

package config

import (
	"app/backend/common"
	"app/backend/types"
	"context"
	"fmt"
	"github.com/wailsapp/wails/v2/pkg/runtime"
	"gopkg.in/yaml.v3"
	"log"
	"os"
	"path/filepath"
	"sync"
)

type AppConfig struct {
	ctx context.Context
	mu  sync.Mutex
}

func (a *AppConfig) Start(ctx context.Context) {
	a.ctx = ctx
}

func (a *AppConfig) GetConfig() *types.Config {
	var defaultConfig = &types.Config{
		Width:    common.Width,
		Height:   common.Height,
		Language: common.Language,
		Theme:    common.Theme,
		Connects: make([]types.Connect, 0),
	}
	configPath := a.getConfigPath()
	data, err := os.ReadFile(configPath)
	if err != nil {
		return defaultConfig
	}
	err = yaml.Unmarshal(data, defaultConfig)
	if err != nil {
		return defaultConfig
	}
	return defaultConfig
}

func (a *AppConfig) SaveConfig(config *types.Config) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	configPath := a.getConfigPath()
	fmt.Println(configPath)

	data, err := yaml.Marshal(config)
	if err != nil {
		return err.Error()
	}

	err = os.WriteFile(configPath, data, 0644)
	if err != nil {
		return err.Error()
	}
	return ""
}
func (a *AppConfig) SaveTheme(theme string) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	config := a.GetConfig()
	config.Theme = theme
	data, err := yaml.Marshal(config)
	if err != nil {
		return err.Error()
	}
	configPath := a.getConfigPath()
	err = os.WriteFile(configPath, data, 0644)
	if err != nil {
		return err.Error()
	}
	return ""
}

func (a *AppConfig) getConfigPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Printf("os.UserHomeDir() error: %s", err.Error())
		return common.ConfigPath
	}
	configDir := filepath.Join(homeDir, common.ConfigDir)
	_, err = os.Stat(configDir)
	if os.IsNotExist(err) {
		err = os.Mkdir(configDir, os.ModePerm)
		if err != nil {
			log.Printf("create configDir %s error: %s", configDir, err.Error())
			return common.ConfigPath
		}
	}
	return filepath.Join(configDir, common.ConfigPath)
}

func (a *AppConfig) GetHistory() []*types.History {
	historyPath := a.getHistoryPath()
	data, err := os.ReadFile(historyPath)
	history := make([]*types.History, 0, 200)
	if err != nil {
		return history
	}
	err = yaml.Unmarshal(data, &history)
	if err != nil {
		return history
	}
	return history
}
func (a *AppConfig) SaveHistory(histories []types.History) string {
	a.mu.Lock()
	defer a.mu.Unlock()
	historyPath := a.getHistoryPath()
	data, err := yaml.Marshal(histories)
	if err != nil {
		return err.Error()
	}
	err = os.WriteFile(historyPath, data, 0644)
	if err != nil {
		return err.Error()
	}
	return ""
}
func (a *AppConfig) getHistoryPath() string {
	homeDir, err := os.UserHomeDir()
	if err != nil {
		log.Printf("os.UserHomeDir() error: %s", err.Error())
		return common.HistoryPath
	}
	configDir := filepath.Join(homeDir, common.ConfigDir)
	_, err = os.Stat(configDir)
	if os.IsNotExist(err) {
		err = os.Mkdir(configDir, os.ModePerm)
		if err != nil {
			log.Printf("create configDir %s error: %s", configDir, err.Error())
			return common.HistoryPath
		}
	}
	return filepath.Join(configDir, common.HistoryPath)
}

// GetVersion returns the application version
func (a *AppConfig) GetVersion() string {
	return common.Version
}

func (a *AppConfig) GetAppName() string {
	return common.AppName
}

func (a *AppConfig) OpenFileDialog(options runtime.OpenDialogOptions) (string, error) {
	return runtime.OpenFileDialog(a.ctx, options)
}

func (a *AppConfig) LogErrToFile(message string) {
	file, err := os.OpenFile(common.ErrLogPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		log.Println("Failed to open log file:", err)
		return
	}
	defer file.Close()

	if _, err := file.WriteString(message); err != nil {
		log.Println("Failed to write to log file:", err)
	}
}
