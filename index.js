import { getRequestHeaders } from '../../../../script.js';
import { oai_settings } from '../../../openai.js';
import { isValidUrl } from '../../../utils.js';
import { registerTtsProvider, getPreviewString, saveTtsProviderSettings } from '../../tts/index.js';

/**
 * Hardcoded voice options with gender from official Google documentation.
 * Source: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts#voice_options
 */
const GEMINI_TTS_VOICES = [
    { name: 'Achernar', voice_id: 'Achernar', lang: 'en-US', gender: 'Female' },
    { name: 'Achird', voice_id: 'Achird', lang: 'en-US', gender: 'Male' },
    { name: 'Algenib', voice_id: 'Algenib', lang: 'en-US', gender: 'Male' },
    { name: 'Algieba', voice_id: 'Algieba', lang: 'en-US', gender: 'Male' },
    { name: 'Alnilam', voice_id: 'Alnilam', lang: 'en-US', gender: 'Male' },
    { name: 'Aoede', voice_id: 'Aoede', lang: 'en-US', gender: 'Female' },
    { name: 'Autonoe', voice_id: 'Autonoe', lang: 'en-US', gender: 'Female' },
    { name: 'Callirrhoe', voice_id: 'Callirrhoe', lang: 'en-US', gender: 'Female' },
    { name: 'Charon', voice_id: 'Charon', lang: 'en-US', gender: 'Male' },
    { name: 'Despina', voice_id: 'Despina', lang: 'en-US', gender: 'Female' },
    { name: 'Enceladus', voice_id: 'Enceladus', lang: 'en-US', gender: 'Male' },
    { name: 'Erinome', voice_id: 'Erinome', lang: 'en-US', gender: 'Female' },
    { name: 'Fenrir', voice_id: 'Fenrir', lang: 'en-US', gender: 'Male' },
    { name: 'Gacrux', voice_id: 'Gacrux', lang: 'en-US', gender: 'Female' },
    { name: 'Iapetus', voice_id: 'Iapetus', lang: 'en-US', gender: 'Male' },
    { name: 'Kore', voice_id: 'Kore', lang: 'en-US', gender: 'Female' },
    { name: 'Laomedeia', voice_id: 'Laomedeia', lang: 'en-US', gender: 'Female' },
    { name: 'Leda', voice_id: 'Leda', lang: 'en-US', gender: 'Female' },
    { name: 'Orus', voice_id: 'Orus', lang: 'en-US', gender: 'Male' },
    { name: 'Pulcherrima', voice_id: 'Pulcherrima', lang: 'en-US', gender: 'Female' },
    { name: 'Puck', voice_id: 'Puck', lang: 'en-US', gender: 'Male' },
    { name: 'Rasalgethi', voice_id: 'Rasalgethi', lang: 'en-US', gender: 'Male' },
    { name: 'Sadachbia', voice_id: 'Sadachbia', lang: 'en-US', gender: 'Male' },
    { name: 'Sadaltager', voice_id: 'Sadaltager', lang: 'en-US', gender: 'Male' },
    { name: 'Schedar', voice_id: 'Schedar', lang: 'en-US', gender: 'Male' },
    { name: 'Sulafat', voice_id: 'Sulafat', lang: 'en-US', gender: 'Female' },
    { name: 'Umbriel', voice_id: 'Umbriel', lang: 'en-US', gender: 'Male' },
    { name: 'Vindemiatrix', voice_id: 'Vindemiatrix', lang: 'en-US', gender: 'Female' },
    { name: 'Zephyr', voice_id: 'Zephyr', lang: 'en-US', gender: 'Female' },
    { name: 'Zubenelgenubi', voice_id: 'Zubenelgenubi', lang: 'en-US', gender: 'Male' },
];

/**
 * Gemini 3.1 Flash TTS Provider for SillyTavern.
 *
 * Adds support for Google's Gemini 3.1 Flash TTS model and other Gemini TTS
 * models. Reuses SillyTavern's existing server-side Google TTS endpoints
 * (which are model-agnostic).
 *
 * Includes voice options with gender info and voice prompt/style control
 * as documented at: https://docs.cloud.google.com/text-to-speech/docs/gemini-tts
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
        voicePrompt: '',
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
                    <option value="gemini-3.1-flash-tts-preview">Gemini 3.1 Flash TTS (Preview)</option>
                    <option value="gemini-2.5-flash-tts">Gemini 2.5 Flash TTS</option>
                    <option value="gemini-2.5-pro-tts">Gemini 2.5 Pro TTS</option>
                    <option value="gemini-2.5-flash-lite-preview-tts">Gemini 2.5 Flash Lite TTS (Preview)</option>
                    <option value="custom">Custom model name...</option>
                </select>
            </div>
            <div id="gemini31-tts-custom-model-block" style="display:none;">
                <label for="gemini31-tts-custom-model">Custom Model ID:</label>
                <input type="text" class="text_pole" id="gemini31-tts-custom-model"
                       placeholder="e.g. gemini-3.1-flash-tts-preview" />
            </div>
            <hr>
            <div>
                <label for="gemini31-tts-voice-prompt">Voice Prompt / Style (optional):</label>
                <small>Natural language instructions for voice style, accent, tone, emotion, and pace.
                This text is prepended to every TTS request as a style directive.</small>
                <textarea id="gemini31-tts-voice-prompt" class="text_pole textarea_compact" rows="3"
                          placeholder="e.g. Speak in a warm, friendly tone with a slight British accent. Read slowly and expressively."></textarea>
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
        $('#gemini31-tts-voice-prompt').val(this.settings.voicePrompt || '');

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
        $('#gemini31-tts-voice-prompt').on('input', () => this.onSettingsChange());

        try {
            await this.checkReady();
            console.debug('Gemini 3.1 TTS: Settings loaded');
        } catch (err) {
            console.warn('Gemini 3.1 TTS: Settings loaded, but not ready.', err.message);
        }
    }

    onSettingsChange() {
        this.settings.apiType = String($('#gemini31-tts-api-type').val());
        this.settings.voicePrompt = String($('#gemini31-tts-voice-prompt').val());
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

        this.voices = []; // Reset voices cache
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
     * Returns the list of Gemini TTS voices with gender information.
     * Uses a local hardcoded list enriched with gender data from official
     * Google documentation, rather than relying on the server endpoint
     * (which lacks gender info).
     */
    async fetchTtsVoiceObjects() {
        // Use the hardcoded voice list with gender info included in the name
        this.voices = GEMINI_TTS_VOICES.map(v => ({
            name: `${v.name} (${v.gender})`,
            voice_id: v.voice_id,
            lang: v.lang,
            gender: v.gender,
            preview_url: false,
        }));

        console.info(`Gemini 3.1 TTS: Loaded ${this.voices.length} voices`);
        return this.voices;
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
     * Build the final text to send to the TTS API.
     * If a voice prompt/style directive is set, prepend it to the text
     * so the Gemini model applies the requested style.
     *
     * @param {string} text The raw text to speak
     * @returns {string} Text with optional style prefix
     */
    buildTtsText(text) {
        const prompt = (this.settings.voicePrompt || '').trim();
        if (!prompt) {
            return text;
        }
        // Prepend the style prompt as instructions before the actual text
        return `${prompt}\n\n${text}`;
    }

    /**
     * Generate TTS audio via SillyTavern's built-in Google TTS endpoint.
     * Passes the selected model name — the server-side endpoint is
     * model-agnostic and will forward it to the Google API as-is.
     */
    async fetchTtsGeneration(text, voiceId) {
        const modelName = this.getModelName();
        const finalText = this.buildTtsText(text);
        console.info(`Generating Gemini 3.1 TTS for voice_id ${voiceId}, model ${modelName}`);

        const useReverseProxy = oai_settings.reverse_proxy && isValidUrl(oai_settings.reverse_proxy);

        const response = await fetch('/api/google/generate-native-tts', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({
                text: finalText,
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
