import { useRef, useState } from 'react';
import {
  Alert,
  ActivityIndicator,
  Button,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as ImagePicker from 'expo-image-picker';
import { getAI, getGenerativeModel } from '@react-native-firebase/ai';

export default function App() {
  const [facing, setFacing] = useState('back');
  const [permission, requestPermission] = useCameraPermissions();
  const [photoUri, setPhotoUri] = useState(null);
  const [mediaPermission, requestMediaPermission] = MediaLibrary.usePermissions();
  const [loading, setLoading] = useState(false);
  const [resultado, setResultado] = useState(null);
  const cameraRef = useRef(null);

  if (!permission) {
    return <View />;
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.message}>
          Necesitamos tu permiso para acceder a la cámara
        </Text>
        <Button onPress={requestPermission} title="Conceder permiso" />
      </View>
    );
  }

  function toggleCameraFacing() {
    setFacing((current) => (current === 'back' ? 'front' : 'back'));
  }

  async function savePhoto(uri) {
    try {
      if (Platform.OS === 'web') {
        const link = document.createElement('a');
        link.href = uri;
        link.download = `foto-${Date.now()}.jpg`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        return;
      }

      if (!mediaPermission?.granted) {
        const permissionResponse = await requestMediaPermission();
        if (!permissionResponse.granted) {
          Alert.alert(
            'Permiso requerido',
            'Necesitamos permiso para guardar la foto en la galería.'
          );
          return;
        }
      }

      await MediaLibrary.saveToLibraryAsync(uri);
    } catch (error) {
      console.error(error);
    }
  }

  // Función para enviar la imagen a Gemini a través de Firebase AI Logic
  async function analizarApunteConGemini(uri) {
    setLoading(true);
    setResultado(null);
    try {
      // Convertir la imagen a base64 usando fetch y FileReader (compatible con expo-camera)
      const responseFile = await fetch(uri);
      const blob = await responseFile.blob();
      const base64Data = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          // Extraer únicamente el contenido base64 sin el prefijo data:*/*;base64,
          const base64String = reader.result.split(',')[1];
          resolve(base64String);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Inicializar Firebase AI y el modelo Gemini
      const ai = getAI();
      const model = getGenerativeModel(ai, { 
        model: 'gemini-2.5-flash',
        generationConfig: {
          responseMimeType: 'application/json',
        }
      });

      const prompt = `Analiza la imagen de este apunte educativo. Extrae la información y responde ÚNICAMENTE en formato JSON estricto que cumpla con la siguiente estructura:
{
  "titulo": "Título descriptivo del tema",
  "resumen": "Resumen conciso del contenido del apunte",
  "conceptos_clave": ["concepto1", "concepto2", "concepto3"],
  "preguntas": [
    {
      "pregunta": "¿Texto de la pregunta?",
      "opciones": ["Opción A", "Opción B", "Opción C", "Opción D"],
      "correcta": 0
    }
  ]
}
Genera exactamente 5 preguntas de opción múltiple basadas en la información visible en el apunte.`;

      const aiResponse = await model.generateContent([
        prompt,
        {
          inlineData: {
            mimeType: 'image/jpeg',
            data: base64Data,
          },
        },
      ]);

      const textResponse = aiResponse.response.text();
      
      // Parseo seguro con try/catch como exige la actividad
      try {
        const parsedData = JSON.parse(textResponse || '{}');
        setResultado(parsedData);
      } catch (parseError) {
        console.error('Error al parsear JSON:', parseError);
        Alert.alert('Error de formato', 'La respuesta de la IA no pudo procesarse correctamente. Intenta con otra foto.');
      }

    } catch (error) {
      console.error('Error al invocar Gemini:', error);
      Alert.alert('Error de conexión', 'Verifica tu conexión a internet o los permisos de Firebase.');
    } finally {
      setLoading(false);
    }
  }

  async function takePicture() {
    try {
      if (!cameraRef.current) return;

      const photo = await cameraRef.current.takePictureAsync({ base64: true });
      setPhotoUri(photo.uri);
      await savePhoto(photo.uri);

      // Si tenemos base64 directo de la cámara o lo procesamos de la URI
      if (photo.base64) {
        analizarApunteConGemini(photo.uri);
      } else {
        analizarApunteConGemini(photo.uri);
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudo tomar la foto.');
      console.error(error);
    }
  }

  // Función adicional para elegir de la galería (requerida por la actividad)
  async function pickFromGallery() {
    try {
      const permissionResult = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permissionResult.granted) {
        Alert.alert('Permiso denegado', 'Se requieren permisos de galería para continuar.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        base64: true,
        quality: 0.7,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setPhotoUri(asset.uri);
        analizarApunteConGemini(asset.uri);
      }
    } catch (error) {
      Alert.alert('Error', 'No se pudo seleccionar la imagen de la galería.');
      console.error(error);
    }
  }

  if (photoUri) {
    return (
      <ScrollView contentContainerStyle={styles.resultContainer}>
        <Image source={{ uri: photoUri }} style={styles.preview} />
        
        {loading && (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#0000ff" />
            <Text style={{ marginTop: 10, fontWeight: 'bold' }}>Analizando apunte con Gemini...</Text>
          </View>
        )}

        {resultado && (
          <View style={styles.resultCard}>
            <Text style={styles.resultTitle}>{resultado.titulo}</Text>
            <Text style={styles.subtitle}>Resumen:</Text>
            <Text>{resultado.resumen}</Text>
            
            <Text style={[styles.subtitle, { marginTop: 10 }]}>Conceptos Clave:</Text>
            {resultado.conceptos_clave?.map((c, index) => (
              <Text key={index}>• {c}</Text>
            ))}

            <Text style={[styles.subtitle, { marginTop: 10 }]}>Preguntas Generadas: {resultado.preguntas?.length}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.retakeButton, loading && { opacity: 0.5 }]}
          onPress={() => {
            if (!loading) {
              setPhotoUri(null);
              setResultado(null);
            }
          }}
          disabled={loading}
        >
          <Text style={styles.text}>Tomar otra foto</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  return (
    <View style={styles.container}>
      <CameraView style={styles.camera} facing={facing} ref={cameraRef}>
        <View style={styles.buttonContainer}>
          <TouchableOpacity style={styles.button} onPress={pickFromGallery}>
            <Text style={styles.textGallery}>Galería</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.captureButton} onPress={takePicture}>
            <View style={styles.captureInner} />
          </TouchableOpacity>

          <TouchableOpacity style={styles.button} onPress={toggleCameraFacing}>
            <Text style={styles.text}>Voltear</Text>
          </TouchableOpacity>
        </View>
      </CameraView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    backgroundColor: '#000',
  },
  resultContainer: {
    flexGrow: 1,
    padding: 20,
    backgroundColor: '#f5f5f5',
    alignItems: 'center',
    paddingTop: 50,
  },
  message: {
    textAlign: 'center',
    paddingBottom: 10,
  },
  camera: {
    flex: 1,
  },
  buttonContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    margin: 32,
    alignItems: 'flex-end',
    justifyContent: 'space-between',
  },
  button: {
    alignSelf: 'flex-end',
    alignItems: 'center',
    paddingBottom: 15,
  },
  captureButton: {
    alignSelf: 'flex-end',
    alignItems: 'center',
    justifyContent: 'center',
    width: 70,
    height: 70,
    borderRadius: 35,
    borderWidth: 4,
    borderColor: 'white',
    backgroundColor: 'transparent',
  },
  captureInner: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: 'white',
  },
  text: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  textGallery: {
    fontSize: 18,
    fontWeight: 'bold',
    color: 'white',
  },
  preview: {
    width: '100%',
    height: 300,
    borderRadius: 10,
    marginBottom: 15,
  },
  loadingBox: {
    padding: 20,
    alignItems: 'center',
  },
  resultCard: {
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    width: '100%',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 5,
    elevation: 3,
  },
  resultTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 8,
  },
  subtitle: {
    fontWeight: 'bold',
    color: '#555',
    marginTop: 8,
  },
  retakeButton: {
    padding: 15,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#007AFF',
    width: '100%',
    marginBottom: 30,
  },
});