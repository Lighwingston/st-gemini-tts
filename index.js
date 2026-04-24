import { getRequestHeaders } from '../../../../script.js';
import { oai_settings } from '../../../openai.js';
import { isValidUrl } from '../../../utils.js';
import { registerTtsProvider, getPreviewString, saveTtsProviderSettings } from '../../tts/index.js';

/**
 * Gemini 3.1 Flash TTS Provider for SillyTavern.
 *
 * Adds support for Google's Gemini 3.1 Flash TTS model while reusing
 * SillyTavern's existing server-side Google TTS endpoints (which are
 * model-agnostic). The only difference from the built-in "Google Gemini TTS"
 * provider is the default model selection (3.1 flash).
 */
class Gemini31FlashTtsProvider {
    settings;
    voices = [];
    separator = ' . ';
    audioElement = document.createElement('audio');

    defaultSettings = {
        voiceMap: {},
        model: 'gemini-3.1-flash-tts-preview',
        customModel: '',
        useCustomModel: false,
        apiType: 'makersuite',
    };

    get settingsHtml() {
        return `
        <small>Hint: Save an API key in the Google AI Studio / Vertex AI connection settings</small>
        <div id="gemini31-tts-settings">
            <div>
                <label for="gemini31-tts-api-type">API Type:</label>
                <select id="gemini31-tts-api-type">
                    <option value="makersuite">Google AI Studio (MakerSuite)</option>
                    <option value="vertexai" disabled>Google Vertex AI (unsupported)</option>
                </select>
            </div>
            <div>
                <label for="gemini31-tts-model">Model:</label>
                <select id="gemini31-tts-model">
                    <option value="gemini-3.1-flash-tts-preview/">Gemini 3.1 Flash Preview TTS</option>
                    <option value="gemini-2.5-flash-preview-tts">Gemini 2.5 Flash Preview TTS</option>
                    <option value="gemini-2.5-pro-preview-tts">Gemini 2.5 Pro Preview TTS</option>
                    <option value="custom">Custom model name...</option>
                </select>
            </div>
            <div id="gemini31-tts-custom-model-block" style="display:none;">
                <label for="gemini31-tts-custom-model">Custom Model ID:</label>
                <input type="text" class="text_pole" id="gemini31-tts-custom-model"
                       placeholder="e.g. gemini-3.1-flash-tts-preview" />
            </div>
        </div>`;
    }

    async loadSettings(settings) {
        if (Object.keys(settings).length === 0) {
            console.info('Gemini 3.1 TTS: Using default settings');
        }

        this.settings = { ...this.defaultSettings, ...settings };

        // Populate UI from settings
        $('#gemini31-tts-api-type').val(this.settings.apiType);

        if (this.settings.useCustomModel && this.settings.customModel) {
            $('#gemini31-tts-model').val('custom');
            $('#gemini31-tts-custom-model').val(this.settings.customModel);
            $('#gemini31-tts-custom-model-block').show();
        } else {
            $('#gemini31-tts-model').val(this.settings.model);
            $('#gemini31-tts-custom-model-block').hide();
        }

        // Bind change handlers
        $('#gemini31-tts-api-type, #gemini31-tts-model').on('change', () => this.onSettingsChange());
        $('#gemini31-tts-custom-model').on('input', () => this.onSettingsChange());

        try {
            await this.checkReady();
            console.debug('Gemini 3.1 TTS: Settings loaded');
        } catch (err) {
            console.warn('Gemini 3.1 TTS: Settings loaded, but not ready.', err.message);
        }
    }

    onSettingsChange() {
        this.settings.apiType = String($('#gemini31-tts-api-type').val());
        const selectedModel = String($('#gemini31-tts-model').val());

        if (selectedModel === 'custom') {
            this.settings.useCustomModel = true;
            this.settings.customModel = String($('#gemini31-tts-custom-model').val()).trim();
            $('#gemini31-tts-custom-model-block').show();
        } else {
            this.settings.useCustomModel = false;
            this.settings.model = selectedModel;
            $('#gemini31-tts-custom-model-block').hide();
        }

        this.voices = []; // Reset voices cache so it re-fetches
        saveTtsProviderSettings();
    }

    /**
     * Returns the effective model name based on current settings.
     * @returns {string}
     */
    getModelName() {
        if (this.settings.useCustomModel && this.settings.customModel) {
            return this.settings.customModel;
        }
        return this.settings.model || this.defaultSettings.model;
    }

    async checkReady() {
        await this.fetchTtsVoiceObjects();
    }

    async onRefreshClick() {
        await this.checkReady();
    }

    async getVoice(voiceName) {
        if (this.voices.length === 0) {
            this.voices = await this.fetchTtsVoiceObjects();
        }

        const match = this.voices.find(
            voice => voice.name === voiceName || voice.voice_id === voiceName,
        );

        if (!match) {
            throw `TTS Voice name ${voiceName} not found`;
        }
        return match;
    }

    async generateTts(text, voiceId) {
        return await this.fetchTtsGeneration(text, voiceId);
    }

    /**
     * Fetch available TTS voices from the server.
     * Uses the built-in SillyTavern endpoint which returns the 30 prebuilt
     * Gemini TTS voices (shared across all Gemini TTS models).
     */
    async fetchTtsVoiceObjects() {
        try {
            const response = await fetch('/api/google/list-native-voices', {
                method: 'POST',
                headers: getRequestHeaders(),
                body: JSON.stringify({}),
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
                try {
                    const errorJson = await response.json();
                    if (errorJson.error) {
                        errorMessage = errorJson.error;
                    }
                } catch (parseError) {
                    console.debug('Error response is not JSON:', parseError.message);
                }
                throw new Error(errorMessage);
            }

            const responseJson = await response.json();

            if (!responseJson.voices || !Array.isArray(responseJson.voices)) {
                throw new Error('Invalid response format: voices array not found');
            }

            this.voices = responseJson.voices;
            console.info(`Gemini 3.1 TTS: Loaded ${this.voices.length} voices`);

            return this.voices;
        } catch (error) {
            console.error('Failed to fetch Gemini 3.1 TTS voices:', error);
            throw error;
        }
    }

    async previewTtsVoice(id) {
        this.audioElement.pause();
        this.audioElement.currentTime = 0;

        try {
            const voice = await this.getVoice(id);
            const text = getPreviewString(voice.lang || 'en-US');

            const response = await this.fetchTtsGeneration(text, id);

            if (!response.ok) {
                return;
            }

            const audioBlob = await response.blob();
            const url = URL.createObjectURL(audioBlob);
            this.audioElement.src = url;
            this.audioElement.play();
            this.audioElement.onended = () => URL.revokeObjectURL(url);
        } catch (error) {
            console.error('TTS Preview Error:', error);
            toastr.error(`Could not generate preview: ${error.message}`);
        }
    }

    /**
     * Generate TTS audio via SillyTavern's built-in Google TTS endpoint.
     * Passes the selected 3.1 model name — the server-side endpoint is
     * model-agnostic and will forward it to the Google API as-is.
     */
    async fetchTtsGeneration(text, voiceId) {
        const modelName = this.getModelName();
        console.info(`Generating Gemini 3.1 TTS for voice_id ${voiceId}, model ${modelName}`);

        const useReverseProxy = oai_settings.reverse_proxy && isValidUrl(oai_settings.reverse_proxy);

        const response = await fetch('/api/google/generate-native-tts', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                text: text,
                voice: voiceId,
                model: modelName,
                api: this.settings.apiType,
                reverse_proxy: useReverseProxy ? oai_settings.reverse_proxy : '',
                proxy_password: useReverseProxy ? oai_settings.proxy_password : '',
                vertexai_auth_mode: oai_settings.vertexai_auth_mode,
                vertexai_region: oai_settings.vertexai_region,
                vertexai_express_project_id: oai_settings.vertexai_express_project_id,
            }),
        });

        if (!response.ok) {
            let errorMessage = `HTTP ${response.status}: ${response.statusText}`;
            try {
                const errorJson = await response.json();
                if (errorJson.error) {
                    errorMessage = errorJson.error;
                }
            } catch {
                // Not a JSON response, keep the original http error
            }
            throw new Error(errorMessage);
        }
        return response;
    }
}

// Register the provider so it appears in SillyTavern's TTS provider dropdown
registerTtsProvider('Gemini 3.1 Flash TTS', Gemini31FlashTtsProvider);
